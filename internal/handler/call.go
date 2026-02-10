package handler

import (
	"bytes"
	"encoding/json"
	"net/http"
	"time"
)

// CallValidate проверяет сессию по query (session_id, timestamp, signature, path) и возвращает user_id.
// Используется микросервисом звонков для валидации WebSocket /call/ws.
func CallValidate(authServiceURL string, client *http.Client) http.HandlerFunc {
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	return func(w http.ResponseWriter, r *http.Request) {
		sessionID := r.URL.Query().Get("session_id")
		timestamp := r.URL.Query().Get("timestamp")
		signature := r.URL.Query().Get("signature")
		path := r.URL.Query().Get("path")
		if path == "" {
			path = "/call/ws"
		}
		if sessionID == "" || timestamp == "" || signature == "" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		body := map[string]string{
			"session_id": sessionID,
			"timestamp":  timestamp,
			"signature":  signature,
			"method":     "GET",
			"path":       path,
			"body":       "",
		}
		jsonBody, _ := json.Marshal(body)
		req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, authServiceURL+"/internal/validate", bytes.NewReader(jsonBody))
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		req.Header.Set("Content-Type", "application/json")
		resp, err := client.Do(req)
		if err != nil {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		var result struct {
			UserID string `json:"user_id"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err != nil || result.UserID == "" {
			w.Header().Set("Content-Type", "application/json; charset=utf-8")
			w.WriteHeader(http.StatusUnauthorized)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "unauthorized"})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"user_id": result.UserID})
	}
}
