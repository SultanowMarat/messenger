-- Роль «Пользователь» (отображается в списке после Администратора)
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS member BOOLEAN NOT NULL DEFAULT TRUE;
