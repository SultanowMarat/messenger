-- Права пользователя в команде (чаты и участники)
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    admin_all_groups BOOLEAN NOT NULL DEFAULT FALSE,
    delete_others_messages BOOLEAN NOT NULL DEFAULT FALSE,
    manage_bots BOOLEAN NOT NULL DEFAULT FALSE,
    edit_others_profile BOOLEAN NOT NULL DEFAULT FALSE,
    invite_to_team BOOLEAN NOT NULL DEFAULT FALSE,
    remove_from_team BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user_id ON user_permissions(user_id);
