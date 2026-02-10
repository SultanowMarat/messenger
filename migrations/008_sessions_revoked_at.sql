-- revoked_at для мягкого отзыва сессии (выход с устройства / со всех устройств).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_id_revoked ON sessions(id, revoked_at);
