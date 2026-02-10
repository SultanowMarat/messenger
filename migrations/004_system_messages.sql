-- Разрешаем content_type 'system' для служебных сообщений (добавлен/исключён участник и т.д.)
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_content_type_check;
-- Привести NULL/пустые к 'text'; включить voice на случай, если 014 уже применяли
UPDATE messages SET content_type = 'text' WHERE content_type IS NULL OR content_type = '';
ALTER TABLE messages ADD CONSTRAINT messages_content_type_check CHECK (content_type IN ('text', 'image', 'file', 'system', 'voice'));
