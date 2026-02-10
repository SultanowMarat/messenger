package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/gorilla/websocket"
	"github.com/messenger/internal/logger"
	"github.com/messenger/internal/middleware"
	"github.com/messenger/internal/ws"
)

type WSHandler struct {
	hub             *ws.Hub
	allowedOrigins  string
}

// NewWSHandler создаёт обработчик WebSocket. allowedOrigins — как в CORS (через запятую или "*").
func NewWSHandler(hub *ws.Hub, allowedOrigins string) *WSHandler {
	return &WSHandler{hub: hub, allowedOrigins: strings.TrimSpace(allowedOrigins)}
}

func (h *WSHandler) checkOrigin(r *http.Request) bool {
	if h.allowedOrigins == "*" || h.allowedOrigins == "" {
		return true
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	for _, o := range strings.Split(h.allowedOrigins, ",") {
		if strings.TrimSpace(o) == origin {
			return true
		}
	}
	return false
}

func (h *WSHandler) ServeWS(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	if userID == "" {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !h.checkOrigin(r) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	upgrader := websocket.Upgrader{
		ReadBufferSize:  1024,
		WriteBufferSize: 1024,
		CheckOrigin:     func(r *http.Request) bool { return h.checkOrigin(r) },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		logger.Errorf("ws upgrade: %v", err)
		return
	}

	ctx, cancel := context.WithCancel(context.Background())
	client := ws.NewClient(h.hub, conn, userID)
	client.Start(ctx, cancel)
	h.hub.Register(client)
}
