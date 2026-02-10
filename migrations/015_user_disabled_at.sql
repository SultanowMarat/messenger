-- Отключение пользователя: администратор может запретить вход (disabled_at IS NOT NULL = не может авторизоваться).
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ DEFAULT NULL;
