-- 002_features.sql: Reply, Edit, Delete, Reactions, Pins, Unread tracking, Search

-- 1. Reply-to support
ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES messages(id) ON DELETE SET NULL;

-- 2. Message editing
ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;

-- 3. Soft-delete messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- 4. Reactions table
CREATE TABLE IF NOT EXISTS message_reactions (
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji VARCHAR(32) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_reactions_message ON message_reactions(message_id);

-- 5. Pinned messages
CREATE TABLE IF NOT EXISTS pinned_messages (
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by UUID NOT NULL REFERENCES users(id),
    pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (chat_id, message_id)
);

-- 6. Unread tracking - last_read_at per member
ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ DEFAULT '1970-01-01T00:00:00Z';

-- 7. Group description
ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- 8. Full-text search: use standard btree index on chat_id for ILIKE queries
-- pg_trgm may not be available in embedded postgres; ILIKE is fast enough for moderate data.
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);
