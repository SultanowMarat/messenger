package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/messenger/internal/middleware"
	"github.com/messenger/internal/model"
	"github.com/messenger/internal/repository"
)

// phoneRe — международный формат: + и 8–15 цифр (E.164).
var phoneRe = regexp.MustCompile(`^\+\d{8,15}$`)

type UserHandler struct {
	userRepo *repository.UserRepository
	msgRepo  *repository.MessageRepository
	permRepo *repository.PermissionRepository
}

func NewUserHandler(userRepo *repository.UserRepository, msgRepo *repository.MessageRepository, permRepo *repository.PermissionRepository) *UserHandler {
	return &UserHandler{userRepo: userRepo, msgRepo: msgRepo, permRepo: permRepo}
}

func (h *UserHandler) GetProfile(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	user, err := h.userRepo.GetByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, user.ToPublic())
}

func (h *UserHandler) GetUser(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, err := h.userRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, user.ToPublic())
}

// UserStatsResponse combines user profile with activity stats.
type UserStatsResponse struct {
	User           model.UserPublic `json:"user"`
	MessagesToday  int              `json:"messages_today"`
	MessagesWeek   int              `json:"messages_week"`
	AvgResponseSec float64          `json:"avg_response_sec"`
}

func (h *UserHandler) GetUserStats(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	user, err := h.userRepo.GetByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	stats, err := h.msgRepo.GetUserStats(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}
	writeJSON(w, http.StatusOK, UserStatsResponse{
		User:           user.ToPublic(),
		MessagesToday:  stats.MessagesToday,
		MessagesWeek:   stats.MessagesWeek,
		AvgResponseSec: stats.AvgResponseSec,
	})
}

func (h *UserHandler) GetUsers(w http.ResponseWriter, r *http.Request) {
	users, err := h.userRepo.ListAll(r.Context(), 500)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list users failed")
		return
	}
	currentUserID := middleware.GetUserID(r.Context())
	result := make([]model.UserPublic, 0, len(users))
	for _, u := range users {
		if u.ID != currentUserID {
			result = append(result, u.ToPublic())
		}
	}
	writeJSON(w, http.StatusOK, result)
}

// GetEmployees возвращает всех пользователей (список сотрудников). Только для администратора.
func (h *UserHandler) GetEmployees(w http.ResponseWriter, r *http.Request) {
	currentUserID := middleware.GetUserID(r.Context())
	perm, err := h.permRepo.GetByUserID(r.Context(), currentUserID)
	if err != nil || !perm.Administrator {
		writeError(w, http.StatusForbidden, "only administrator can list employees")
		return
	}
	users, err := h.userRepo.ListAll(r.Context(), 2000)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "list employees failed")
		return
	}
	result := make([]model.UserPublic, 0, len(users))
	for _, u := range users {
		result = append(result, u.ToPublic())
	}
	writeJSON(w, http.StatusOK, result)
}

// CreateUserRequest — создание пользователя администратором (сотрудник без входа; при первом входе по email станет его профиль).
type CreateUserRequest struct {
	Email       string  `json:"email"`
	Username    string  `json:"username"`
	Phone       string  `json:"phone"`
	AvatarURL   string  `json:"avatar_url"`
	Permissions *struct {
		Administrator        *bool `json:"administrator"`
		Member               *bool `json:"member"`
		AdminAllGroups       *bool `json:"admin_all_groups"`
		DeleteOthersMessages *bool `json:"delete_others_messages"`
		ManageBots           *bool `json:"manage_bots"`
		EditOthersProfile    *bool `json:"edit_others_profile"`
		InviteToTeam         *bool `json:"invite_to_team"`
		RemoveFromTeam       *bool `json:"remove_from_team"`
	} `json:"permissions"`
}

// CreateUser создаёт пользователя (админ). Email и имя обязательны. При первом входе по этой почте пользователь получит этот профиль.
func (h *UserHandler) CreateUser(w http.ResponseWriter, r *http.Request) {
	currentUserID := middleware.GetUserID(r.Context())
	perm, err := h.permRepo.GetByUserID(r.Context(), currentUserID)
	if err != nil || !perm.Administrator {
		writeError(w, http.StatusForbidden, "only administrator can create users")
		return
	}
	var req CreateUserRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	emailNorm := strings.TrimSpace(strings.ToLower(req.Email))
	username := strings.TrimSpace(req.Username)
	if emailNorm == "" || username == "" {
		writeError(w, http.StatusBadRequest, "email and username required")
		return
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email format")
		return
	}
	phone := strings.TrimSpace(req.Phone)
	if phone != "" && !phoneRe.MatchString(phone) {
		writeError(w, http.StatusBadRequest, "invalid phone: use international format (+ and 8–15 digits)")
		return
	}
	_, err = h.userRepo.GetByEmail(r.Context(), emailNorm)
	if err == nil {
		writeError(w, http.StatusConflict, "user with this email already exists")
		return
	}
	if !errors.Is(err, repository.ErrNotFound) {
		writeError(w, http.StatusInternalServerError, "failed to check email")
		return
	}
	u := &model.User{
		ID:           uuid.New().String(),
		Username:     username,
		Email:        emailNorm,
		Phone:        phone,
		PasswordHash: "",
		AvatarURL:    strings.TrimSpace(req.AvatarURL),
		LastSeenAt:   time.Now().UTC(),
		IsOnline:     false,
		CreatedAt:    time.Now().UTC(),
	}
	if err := h.userRepo.Create(r.Context(), u); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to create user")
		return
	}
	permNew := &model.UserPermissions{UserID: u.ID, Member: true}
	if req.Permissions != nil {
		if req.Permissions.Administrator != nil {
			permNew.Administrator = *req.Permissions.Administrator
		}
		if req.Permissions.Member != nil {
			permNew.Member = *req.Permissions.Member
		}
		if req.Permissions.AdminAllGroups != nil {
			permNew.AdminAllGroups = *req.Permissions.AdminAllGroups
		}
		if req.Permissions.DeleteOthersMessages != nil {
			permNew.DeleteOthersMessages = *req.Permissions.DeleteOthersMessages
		}
		if req.Permissions.ManageBots != nil {
			permNew.ManageBots = *req.Permissions.ManageBots
		}
		if req.Permissions.EditOthersProfile != nil {
			permNew.EditOthersProfile = *req.Permissions.EditOthersProfile
		}
		if req.Permissions.InviteToTeam != nil {
			permNew.InviteToTeam = *req.Permissions.InviteToTeam
		}
		if req.Permissions.RemoveFromTeam != nil {
			permNew.RemoveFromTeam = *req.Permissions.RemoveFromTeam
		}
	}
	if err := h.permRepo.Upsert(r.Context(), permNew); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to set permissions")
		return
	}
	writeJSON(w, http.StatusCreated, u.ToPublic())
}

func (h *UserHandler) SearchUsers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		writeJSON(w, http.StatusOK, []model.UserPublic{})
		return
	}

	users, err := h.userRepo.SearchByUsername(r.Context(), query, 20)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "search failed")
		return
	}

	currentUserID := middleware.GetUserID(r.Context())
	result := make([]model.UserPublic, 0, len(users))
	for _, u := range users {
		if u.ID != currentUserID {
			result = append(result, u.ToPublic())
		}
	}
	writeJSON(w, http.StatusOK, result)
}

type UpdateProfileRequest struct {
	Username  string `json:"username"`
	AvatarURL string `json:"avatar_url"`
	Email     string `json:"email"`
	Phone     string `json:"phone"`
}

func (h *UserHandler) UpdateProfile(w http.ResponseWriter, r *http.Request) {
	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}

	// Валидация email (если передан)
	reqEmail := strings.TrimSpace(req.Email)
	if reqEmail != "" {
		if _, err := mail.ParseAddress(reqEmail); err != nil {
			writeError(w, http.StatusBadRequest, "invalid email format")
			return
		}
	}

	// Валидация телефона (если передан): строго +993XXXXXXXX
	reqPhone := strings.TrimSpace(req.Phone)
	if reqPhone != "" {
		if !phoneRe.MatchString(reqPhone) {
			writeError(w, http.StatusBadRequest, "invalid phone: use international format (+ and 8–15 digits)")
			return
		}
	}

	userID := middleware.GetUserID(r.Context())
	user, err := h.userRepo.GetByID(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}

	username := user.Username
	if req.Username != "" {
		username = req.Username
	}
	avatarURL := user.AvatarURL
	if req.AvatarURL != "" {
		avatarURL = req.AvatarURL
	}
	email := user.Email
	if reqEmail != "" {
		email = reqEmail
	}
	phone := user.Phone
	if reqPhone != "" {
		phone = reqPhone
	}

	if err := h.userRepo.UpdateProfile(r.Context(), userID, username, avatarURL, email, phone); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}

	user.Username = username
	user.AvatarURL = avatarURL
	user.Email = email
	user.Phone = phone
	writeJSON(w, http.StatusOK, user.ToPublic())
}

// UpdateUserProfile обновляет профиль пользователя по id. Своё — всегда, чужое — только администратор.
func (h *UserHandler) UpdateUserProfile(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	currentUserID := middleware.GetUserID(r.Context())
	if id == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	if id != currentUserID {
		myPerm, err := h.permRepo.GetByUserID(r.Context(), currentUserID)
		if err != nil || !myPerm.Administrator {
			writeError(w, http.StatusForbidden, "only administrator can edit other user profile")
			return
		}
	}
	var req UpdateProfileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	reqEmail := strings.TrimSpace(req.Email)
	if reqEmail != "" {
		if _, err := mail.ParseAddress(reqEmail); err != nil {
			writeError(w, http.StatusBadRequest, "invalid email format")
			return
		}
	}
	reqPhone := strings.TrimSpace(req.Phone)
	if reqPhone != "" {
		if !phoneRe.MatchString(reqPhone) {
			writeError(w, http.StatusBadRequest, "invalid phone: use international format (+ and 8–15 digits)")
			return
		}
	}
	user, err := h.userRepo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	username := user.Username
	if req.Username != "" {
		username = req.Username
	}
	avatarURL := user.AvatarURL
	if req.AvatarURL != "" {
		avatarURL = req.AvatarURL
	}
	email := user.Email
	if reqEmail != "" {
		email = reqEmail
	}
	phone := user.Phone
	if reqPhone != "" {
		phone = reqPhone
	}
	if err := h.userRepo.UpdateProfile(r.Context(), id, username, avatarURL, email, phone); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update profile")
		return
	}
	user.Username = username
	user.AvatarURL = avatarURL
	user.Email = email
	user.Phone = phone
	writeJSON(w, http.StatusOK, user.ToPublic())
}

func (h *UserHandler) GetFavorites(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	ids, err := h.userRepo.GetFavoriteChatIDs(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get favorites")
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"chat_ids": ids})
}

func (h *UserHandler) AddFavorite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	var req struct {
		ChatID string `json:"chat_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ChatID == "" {
		writeError(w, http.StatusBadRequest, "chat_id required")
		return
	}
	if err := h.userRepo.AddFavorite(r.Context(), userID, req.ChatID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to add favorite")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *UserHandler) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r.Context())
	chatID := chi.URLParam(r, "chatId")
	if chatID == "" {
		writeError(w, http.StatusBadRequest, "chat_id required")
		return
	}
	if err := h.userRepo.RemoveFavorite(r.Context(), userID, chatID); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to remove favorite")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *UserHandler) GetUserPermissions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	if _, err := h.userRepo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	perm, err := h.permRepo.GetByUserID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get permissions")
		return
	}
	writeJSON(w, http.StatusOK, perm)
}

type UpdatePermissionsRequest struct {
	Administrator        *bool `json:"administrator"`
	Member               *bool `json:"member"`
	AdminAllGroups       *bool `json:"admin_all_groups"`
	DeleteOthersMessages *bool `json:"delete_others_messages"`
	ManageBots           *bool `json:"manage_bots"`
	EditOthersProfile    *bool `json:"edit_others_profile"`
	InviteToTeam         *bool `json:"invite_to_team"`
	RemoveFromTeam       *bool `json:"remove_from_team"`
}

func (h *UserHandler) UpdateUserPermissions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	currentUserID := middleware.GetUserID(r.Context())
	if id == "" {
		writeError(w, http.StatusBadRequest, "user id required")
		return
	}
	if _, err := h.userRepo.GetByID(r.Context(), id); err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	// Менять права другого пользователя может только администратор
	if id != currentUserID {
		myPerm, err := h.permRepo.GetByUserID(r.Context(), currentUserID)
		if err != nil || !myPerm.Administrator {
			writeError(w, http.StatusForbidden, "only administrator can edit other user permissions")
			return
		}
	}
	var req UpdatePermissionsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	perm, err := h.permRepo.GetByUserID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to get permissions")
		return
	}
	if req.Administrator != nil {
		perm.Administrator = *req.Administrator
	}
	if req.Member != nil {
		perm.Member = *req.Member
	}
	if req.AdminAllGroups != nil {
		perm.AdminAllGroups = *req.AdminAllGroups
	}
	if req.DeleteOthersMessages != nil {
		perm.DeleteOthersMessages = *req.DeleteOthersMessages
	}
	if req.ManageBots != nil {
		perm.ManageBots = *req.ManageBots
	}
	if req.EditOthersProfile != nil {
		perm.EditOthersProfile = *req.EditOthersProfile
	}
	if req.InviteToTeam != nil {
		perm.InviteToTeam = *req.InviteToTeam
	}
	if req.RemoveFromTeam != nil {
		perm.RemoveFromTeam = *req.RemoveFromTeam
	}
	if err := h.permRepo.Upsert(r.Context(), perm); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save permissions")
		return
	}
	writeJSON(w, http.StatusOK, perm)
}

// SetUserDisabledRequest тело запроса включить/отключить пользователя.
type SetUserDisabledRequest struct {
	Disabled bool `json:"disabled"`
}

// SetUserDisabled отключает или включает пользователя (только администратор). Отключённый не может войти.
func (h *UserHandler) SetUserDisabled(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	currentUserID := middleware.GetUserID(r.Context())
	myPerm, err := h.permRepo.GetByUserID(r.Context(), currentUserID)
	if err != nil || !myPerm.Administrator {
		writeError(w, http.StatusForbidden, "only administrator can disable or enable users")
		return
	}
	if id == currentUserID {
		writeError(w, http.StatusBadRequest, "нельзя отключить самого себя")
		return
	}
	_, err = h.userRepo.GetByID(r.Context(), id)
	if err != nil {
		if errors.Is(err, repository.ErrNotFound) {
			writeError(w, http.StatusNotFound, "user not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get user")
		return
	}
	var req SetUserDisabledRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := h.userRepo.SetDisabled(r.Context(), id, req.Disabled); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to update user")
		return
	}
	writeJSON(w, http.StatusOK, map[string]bool{"disabled": req.Disabled})
}
