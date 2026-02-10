package callserver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/messenger/internal/logger"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10
	maxMsgSize = 65536
)

// CallState — состояние одного звонка.
type CallState struct {
	ID        string
	FromUser  string
	ToUser    string
	Status    string // ringing, active, ended
	CreatedAt time.Time
}

// Hub — хаб сигнализации звонков (WebRTC offer/answer/ICE).
type Hub struct {
	mu       sync.RWMutex
	clients  map[string]*callConn // user_id -> одна активная коннекция
	calls    map[string]*CallState
	validate func(ctx context.Context, sessionID, timestamp, signature, path string) (userID string, err error)
}

type callConn struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
	hub    *Hub
	done   chan struct{}
}

// NewHub создаёт хаб звонков. apiURL — базовый URL API для валидации (если nil — validate вызывается извне).
func NewHub(validate func(ctx context.Context, sessionID, timestamp, signature, path string) (userID string, err error)) *Hub {
	return &Hub{
		clients:  make(map[string]*callConn),
		calls:    make(map[string]*CallState),
		validate: validate,
	}
}

// ValidateViaHTTP проверяет сессию запросом к API (GET /api/call/validate?session_id=...&timestamp=...&signature=...&path=/call/ws).
func ValidateViaHTTP(apiURL string, client *http.Client) func(ctx context.Context, sessionID, timestamp, signature, path string) (string, error) {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return func(ctx context.Context, sessionID, timestamp, signature, path string) (string, error) {
		q := url.Values{}
		q.Set("session_id", sessionID)
		q.Set("timestamp", timestamp)
		q.Set("signature", signature)
		q.Set("path", path)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL+"/api/call/validate?"+q.Encode(), nil)
		if err != nil {
			return "", err
		}
		resp, err := client.Do(req)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			return "", errUnauthorized
		}
		var out struct {
			UserID string `json:"user_id"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil || out.UserID == "" {
			return "", errUnauthorized
		}
		return out.UserID, nil
	}
}

var errUnauthorized = &authErr{msg: "unauthorized"}

type authErr struct{ msg string }

func (e *authErr) Error() string { return e.msg }

// ServeWS обрабатывает WebSocket /call/ws. Query: session_id, timestamp, signature.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	timestamp := r.URL.Query().Get("timestamp")
	signature := r.URL.Query().Get("signature")
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/call/ws"
	}
	if sessionID == "" || timestamp == "" || signature == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	userID, err := h.validate(r.Context(), sessionID, timestamp, signature, path)
	if err != nil {
		logger.Errorf("call ws validate failed: %v", err)
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(*http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("call ws upgrade: %v", err)
		return
	}

	c := &callConn{
		userID: userID,
		conn:   conn,
		send:   make(chan []byte, 64),
		hub:    h,
		done:   make(chan struct{}),
	}
	h.register(c)
	logger.Infof("call ws connected user_id=%s", userID)
	go c.writePump()
	c.readPump()
}

func (h *Hub) register(c *callConn) {
	h.mu.Lock()
	if old, ok := h.clients[c.userID]; ok {
		old.close()
	}
	h.clients[c.userID] = c
	h.mu.Unlock()
}

func (h *Hub) unregister(c *callConn) {
	h.mu.Lock()
	if h.clients[c.userID] == c {
		delete(h.clients, c.userID)
		logger.Infof("call ws disconnected user_id=%s", c.userID)
	}
	// завершить все активные звонки пользователя
	for id, call := range h.calls {
		if call.Status != "ended" && (call.FromUser == c.userID || call.ToUser == c.userID) {
			call.Status = "ended"
			other := call.ToUser
			if other == c.userID {
				other = call.FromUser
			}
			if oc := h.clients[other]; oc != nil {
				oc.sendMsg("hangup", map[string]string{"call_id": id})
			}
		}
	}
	h.mu.Unlock()
	c.close()
}

func (c *callConn) close() {
	select {
	case <-c.done:
		return
	default:
		close(c.done)
		c.conn.Close()
	}
}

func (c *callConn) sendMsg(typ string, payload any) {
	select {
	case <-c.done:
		return
	default:
		b, _ := json.Marshal(map[string]any{"type": typ, "payload": payload})
		select {
		case c.send <- b:
		default:
		}
	}
}

func (c *callConn) readPump() {
	defer func() {
		c.hub.unregister(c)
	}()
	c.conn.SetReadLimit(maxMsgSize)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		var msg struct {
			Type    string          `json:"type"`
			Payload json.RawMessage `json:"payload"`
		}
		if err := json.Unmarshal(data, &msg); err != nil {
			c.sendMsg("error", map[string]string{"error": "invalid json"})
			logger.Errorf("call invalid json user_id=%s", c.userID)
			continue
		}
		c.hub.handleMessage(c, msg.Type, msg.Payload)
	}
}

func (c *callConn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case b, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, nil)
				return
			}
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.TextMessage, b); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (h *Hub) handleMessage(c *callConn, typ string, payload json.RawMessage) {
	switch typ {
	case "start_call":
		var body struct {
			PeerID string `json:"peer_id"`
		}
		if json.Unmarshal(payload, &body) != nil || body.PeerID == "" {
			c.sendMsg("error", map[string]string{"error": "peer_id required"})
			return
		}
		if body.PeerID == c.userID {
			c.sendMsg("error", map[string]string{"error": "cannot call yourself"})
			return
		}
		h.mu.Lock()
		peer, ok := h.clients[body.PeerID]
		if !ok {
			h.mu.Unlock()
			c.sendMsg("error", map[string]string{"error": "user offline"})
			return
		}
		callID := uuid.New().String()
		h.calls[callID] = &CallState{ID: callID, FromUser: c.userID, ToUser: body.PeerID, Status: "ringing", CreatedAt: time.Now()}
		h.mu.Unlock()
		peer.sendMsg("incoming_call", map[string]any{
			"call_id":       callID,
			"from_user_id": c.userID,
		})
		c.sendMsg("call_started", map[string]any{"call_id": callID})
		logger.Infof("call started call_id=%s from=%s to=%s", callID, c.userID, body.PeerID)

	case "accept_call":
		var body struct {
			CallID string `json:"call_id"`
		}
		if json.Unmarshal(payload, &body) != nil || body.CallID == "" {
			c.sendMsg("error", map[string]string{"error": "call_id required"})
			return
		}
		h.mu.Lock()
		call, ok := h.calls[body.CallID]
		if !ok || call.Status != "ringing" || call.ToUser != c.userID {
			h.mu.Unlock()
			c.sendMsg("error", map[string]string{"error": "invalid call"})
			return
		}
		call.Status = "active"
		caller := h.clients[call.FromUser]
		h.mu.Unlock()
		if caller != nil {
			caller.sendMsg("call_accepted", map[string]string{"call_id": body.CallID})
		}
		c.sendMsg("call_accepted", map[string]string{"call_id": body.CallID})
		logger.Infof("call accepted call_id=%s by=%s", body.CallID, c.userID)

	case "reject_call":
		var body struct {
			CallID string `json:"call_id"`
		}
		json.Unmarshal(payload, &body)
		h.mu.Lock()
		call, ok := h.calls[body.CallID]
		if ok && call.Status == "ringing" {
			call.Status = "ended"
			caller := h.clients[call.FromUser]
			h.mu.Unlock()
			if caller != nil {
				caller.sendMsg("call_rejected", map[string]string{"call_id": body.CallID})
			}
			logger.Infof("call rejected call_id=%s by=%s", body.CallID, c.userID)
		} else {
			h.mu.Unlock()
		}

	case "hangup":
		var body struct {
			CallID string `json:"call_id"`
		}
		json.Unmarshal(payload, &body)
		h.mu.Lock()
		call, ok := h.calls[body.CallID]
		if ok && call.Status != "ended" {
			call.Status = "ended"
			other := call.ToUser
			if other == c.userID {
				other = call.FromUser
			}
			peer := h.clients[other]
			h.mu.Unlock()
			if peer != nil {
				peer.sendMsg("hangup", map[string]string{"call_id": body.CallID})
			}
			logger.Infof("call hangup call_id=%s by=%s", body.CallID, c.userID)
		} else {
			h.mu.Unlock()
		}

	case "offer", "answer", "ice":
		var body struct {
			CallID    string `json:"call_id"`
			SDP       string `json:"sdp,omitempty"`
			Candidate string `json:"candidate,omitempty"`
		}
		if json.Unmarshal(payload, &body) != nil {
			c.sendMsg("error", map[string]string{"error": "invalid payload"})
			return
		}
		h.mu.Lock()
		call, ok := h.calls[body.CallID]
		if !ok || call.Status == "ended" {
			h.mu.Unlock()
			return
		}
		other := call.ToUser
		if other == c.userID {
			other = call.FromUser
		}
		peer := h.clients[other]
		h.mu.Unlock()
		if peer == nil {
			return
		}
		payloadMap := map[string]any{"call_id": body.CallID}
		if body.SDP != "" {
			payloadMap["sdp"] = body.SDP
		}
		if body.Candidate != "" {
			payloadMap["candidate"] = body.Candidate
		}
		peer.sendMsg(typ, payloadMap)
	default:
		logger.Errorf("call unknown message type=%s user_id=%s", typ, c.userID)
		c.sendMsg("error", map[string]string{"error": "unknown type: " + typ})
	}
}

func cleanClose(code int, text string) []byte {
	return websocket.FormatCloseMessage(code, strings.TrimSpace(text))
}
