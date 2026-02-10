-- Разрешить тип чата 'notes' (заметки пользователя)
DO $$
DECLARE
  conname text;
BEGIN
  FOR conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND NOT a.attisdropped
    WHERE c.conrelid = 'chats'::regclass AND c.contype = 'c' AND a.attname = 'chat_type'
  LOOP
    EXECUTE format('ALTER TABLE chats DROP CONSTRAINT %I', conname);
  END LOOP;
END $$;
ALTER TABLE chats ADD CONSTRAINT chats_chat_type_check CHECK (chat_type IN ('personal', 'group', 'notes'));
