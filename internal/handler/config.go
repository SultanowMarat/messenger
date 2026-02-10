package handler

import (
	"net/http"

	"github.com/messenger/internal/config"
)

// ConfigHandler отдаёт публичные параметры конфигурации (например, кеш для клиента).
type ConfigHandler struct {
	cfg *config.Config
}

// NewConfigHandler создаёт обработчик конфигурации.
func NewConfigHandler(cfg *config.Config) *ConfigHandler {
	return &ConfigHandler{cfg: cfg}
}

// GetCacheConfig возвращает настройки кеша для клиента (без авторизации).
func (h *ConfigHandler) GetCacheConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]int{
		"ttl_minutes": h.cfg.Cache.TTLMinutes,
	})
}

// GetPushConfig возвращает публичный VAPID-ключ для подписки на пуши (если включены).
func (h *ConfigHandler) GetPushConfig(w http.ResponseWriter, r *http.Request) {
	if h.cfg.PushServiceURL == "" || h.cfg.PushVAPIDPublicKey == "" {
		writeJSON(w, http.StatusOK, map[string]interface{}{"enabled": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"enabled":          true,
		"vapid_public_key": h.cfg.PushVAPIDPublicKey,
	})
}

// GetCallConfig возвращает публичные настройки для звонков (ICE-серверы).
func (h *ConfigHandler) GetCallConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"ice_servers": h.cfg.CallICEServers,
	})
}
