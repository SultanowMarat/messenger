-- Право «Администратор» (отображается первым в списке)
ALTER TABLE user_permissions ADD COLUMN IF NOT EXISTS administrator BOOLEAN NOT NULL DEFAULT FALSE;
