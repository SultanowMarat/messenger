package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/messenger/internal/logger"
	"github.com/messenger/internal/model"
)

var ErrNotFound = errors.New("not found")

// userCols — список колонок для SELECT, включая phone и disabled_at.
const userCols = `id, username, email, COALESCE(phone,''), password_hash, avatar_url, last_seen_at, is_online, created_at, disabled_at`

type UserRepository struct {
	pool *pgxpool.Pool
}

func NewUserRepository(pool *pgxpool.Pool) *UserRepository {
	return &UserRepository{pool: pool}
}

// scanUser сканирует строку в model.User (порядок соответствует userCols).
func scanUser(s interface{ Scan(dest ...any) error }, u *model.User) error {
	return s.Scan(&u.ID, &u.Username, &u.Email, &u.Phone, &u.PasswordHash, &u.AvatarURL, &u.LastSeenAt, &u.IsOnline, &u.CreatedAt, &u.DisabledAt)
}

func (r *UserRepository) Create(ctx context.Context, u *model.User) error {
	defer logger.DeferLogDuration("user.Create", time.Now())()
	_, err := r.pool.Exec(ctx,
		`INSERT INTO users (id, username, email, phone, password_hash, avatar_url, last_seen_at, is_online, created_at, disabled_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		u.ID, u.Username, u.Email, u.Phone, u.PasswordHash, u.AvatarURL, u.LastSeenAt, u.IsOnline, u.CreatedAt, u.DisabledAt,
	)
	if err != nil {
		return fmt.Errorf("userRepo.Create: %w", err)
	}
	return nil
}

func (r *UserRepository) GetByID(ctx context.Context, id string) (*model.User, error) {
	defer logger.DeferLogDuration("user.GetByID", time.Now())()
	u := &model.User{}
	row := r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE id = $1`, id)
	if err := scanUser(row, u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("userRepo.GetByID: %w", err)
	}
	return u, nil
}

func (r *UserRepository) GetByUsername(ctx context.Context, username string) (*model.User, error) {
	defer logger.DeferLogDuration("user.GetByUsername", time.Now())()
	u := &model.User{}
	row := r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE username = $1`, username)
	if err := scanUser(row, u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("userRepo.GetByUsername: %w", err)
	}
	return u, nil
}

func (r *UserRepository) GetByEmail(ctx context.Context, email string) (*model.User, error) {
	defer logger.DeferLogDuration("user.GetByEmail", time.Now())()
	u := &model.User{}
	row := r.pool.QueryRow(ctx, `SELECT `+userCols+` FROM users WHERE email = $1`, email)
	if err := scanUser(row, u); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("userRepo.GetByEmail: %w", err)
	}
	return u, nil
}

func (r *UserRepository) ListAll(ctx context.Context, limit int) ([]model.User, error) {
	defer logger.DeferLogDuration("user.ListAll", time.Now())()
	rows, err := r.pool.Query(ctx,
		`SELECT `+userCols+` FROM users ORDER BY username LIMIT $1`,
		limit,
	)
	if err != nil {
		return nil, fmt.Errorf("userRepo.ListAll: %w", err)
	}
	defer rows.Close()
	users := make([]model.User, 0, limit)
	for rows.Next() {
		var u model.User
		if err := scanUser(rows, &u); err != nil {
			return nil, fmt.Errorf("userRepo.ListAll scan: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userRepo.ListAll rows: %w", err)
	}
	return users, nil
}

func (r *UserRepository) SearchByUsername(ctx context.Context, query string, limit int) ([]model.User, error) {
	defer logger.DeferLogDuration("user.SearchByUsername", time.Now())()
	rows, err := r.pool.Query(ctx,
		`SELECT `+userCols+` FROM users WHERE username ILIKE $1 ORDER BY username LIMIT $2`,
		"%"+query+"%", limit,
	)
	if err != nil {
		return nil, fmt.Errorf("userRepo.SearchByUsername query: %w", err)
	}
	defer rows.Close()

	users := make([]model.User, 0, limit)
	for rows.Next() {
		var u model.User
		if err := scanUser(rows, &u); err != nil {
			return nil, fmt.Errorf("userRepo.SearchByUsername scan: %w", err)
		}
		users = append(users, u)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("userRepo.SearchByUsername rows: %w", err)
	}
	return users, nil
}

func (r *UserRepository) SetOnline(ctx context.Context, userID string, online bool) error {
	defer logger.DeferLogDuration("user.SetOnline", time.Now())()
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET is_online = $1, last_seen_at = $2 WHERE id = $3`,
		online, time.Now().UTC(), userID,
	)
	if err != nil {
		return fmt.Errorf("userRepo.SetOnline: %w", err)
	}
	return nil
}

func (r *UserRepository) UpdateProfile(ctx context.Context, userID, username, avatarURL, email, phone string) error {
	defer logger.DeferLogDuration("user.UpdateProfile", time.Now())()
	_, err := r.pool.Exec(ctx,
		`UPDATE users SET username = $1, avatar_url = $2, email = $3, phone = $4 WHERE id = $5`,
		username, avatarURL, email, phone, userID,
	)
	if err != nil {
		return fmt.Errorf("userRepo.UpdateProfile: %w", err)
	}
	return nil
}

func (r *UserRepository) GetFavoriteChatIDs(ctx context.Context, userID string) ([]string, error) {
	defer logger.DeferLogDuration("user.GetFavoriteChatIDs", time.Now())()
	rows, err := r.pool.Query(ctx,
		`SELECT chat_id FROM user_favorite_chats WHERE user_id = $1 ORDER BY chat_id`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("userRepo.GetFavoriteChatIDs: %w", err)
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("userRepo.GetFavoriteChatIDs scan: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *UserRepository) AddFavorite(ctx context.Context, userID, chatID string) error {
	defer logger.DeferLogDuration("user.AddFavorite", time.Now())()
	_, err := r.pool.Exec(ctx,
		`INSERT INTO user_favorite_chats (user_id, chat_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		userID, chatID,
	)
	if err != nil {
		return fmt.Errorf("userRepo.AddFavorite: %w", err)
	}
	return nil
}

func (r *UserRepository) RemoveFavorite(ctx context.Context, userID, chatID string) error {
	defer logger.DeferLogDuration("user.RemoveFavorite", time.Now())()
	_, err := r.pool.Exec(ctx,
		`DELETE FROM user_favorite_chats WHERE user_id = $1 AND chat_id = $2`,
		userID, chatID,
	)
	if err != nil {
		return fmt.Errorf("userRepo.RemoveFavorite: %w", err)
	}
	return nil
}

// SetDisabled выставляет или снимает отключение пользователя (только для администратора через API).
func (r *UserRepository) SetDisabled(ctx context.Context, userID string, disabled bool) error {
	defer logger.DeferLogDuration("user.SetDisabled", time.Now())()
	if disabled {
		_, err := r.pool.Exec(ctx, `UPDATE users SET disabled_at = NOW() WHERE id = $1`, userID)
		if err != nil {
			return fmt.Errorf("userRepo.SetDisabled: %w", err)
		}
	} else {
		_, err := r.pool.Exec(ctx, `UPDATE users SET disabled_at = NULL WHERE id = $1`, userID)
		if err != nil {
			return fmt.Errorf("userRepo.SetDisabled: %w", err)
		}
	}
	return nil
}
