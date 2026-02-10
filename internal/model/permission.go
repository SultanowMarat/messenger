package model

import "time"

// UserPermissions — права пользователя в команде (чаты и участники).
type UserPermissions struct {
	UserID                string    `json:"user_id"`
	Administrator         bool      `json:"administrator"`
	Member                bool      `json:"member"`
	AdminAllGroups        bool      `json:"admin_all_groups"`
	DeleteOthersMessages  bool      `json:"delete_others_messages"`
	ManageBots            bool      `json:"manage_bots"`
	EditOthersProfile     bool      `json:"edit_others_profile"`
	InviteToTeam          bool      `json:"invite_to_team"`
	RemoveFromTeam        bool      `json:"remove_from_team"`
	UpdatedAt             time.Time `json:"updated_at"`
}
