-- Для режима -dev: хранить session_secret в БД, чтобы сессии переживали перезапуск Auth.
-- В проде секрет хранится только в Redis; колонка используется только при запуске Auth с -dev.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_secret TEXT DEFAULT NULL;
