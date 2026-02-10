-- Добавляем поле телефона в таблицу пользователей
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) DEFAULT '';
