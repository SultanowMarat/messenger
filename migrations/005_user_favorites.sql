-- Избранные чаты пользователя
CREATE TABLE IF NOT EXISTS user_favorite_chats (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_user_favorite_chats_user_id ON user_favorite_chats(user_id);
