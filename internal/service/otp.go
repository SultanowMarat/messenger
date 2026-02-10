package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/messenger/internal/email"
	"github.com/messenger/internal/logger"
	"github.com/messenger/internal/model"
	"github.com/messenger/internal/repository"
	"github.com/messenger/internal/storage"
)

var (
	ErrRateLimitExceeded = errors.New("rate limit exceeded")
	ErrInvalidOTP        = errors.New("invalid or expired OTP")
	ErrInvalidEmail      = errors.New("invalid email format")
	ErrUserDisabled      = errors.New("user disabled")
)

func maskSessionID(s string) string {
	s = strings.TrimSpace(s)
	if len(s) <= 4 {
		return "****"
	}
	return s[:4] + "***"
}

type OTPAuthService struct {
	userRepo    *repository.UserRepository
	sessionRepo *repository.SessionRepository
	store       storage.SessionOTPStore
	mailer      *email.Sender
}

func NewOTPAuthService(
	userRepo *repository.UserRepository,
	sessionRepo *repository.SessionRepository,
	store storage.SessionOTPStore,
	mailer *email.Sender,
) *OTPAuthService {
	return &OTPAuthService{
		userRepo: userRepo, sessionRepo: sessionRepo, store: store, mailer: mailer,
	}
}

type RequestCodeRequest struct {
	Email      string `json:"email"`
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"`
}

// Валидация email: допустимый формат (упрощённый, без полного RFC).
var emailRegexp = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

// onlyDigits оставляет в строке только цифры (для кода из письма — убирает пробелы и невидимые символы при вставке).
func onlyDigits(s string) string {
	var b []byte
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			b = append(b, s[i])
		}
	}
	return string(b)
}

// normalizeEmailForKey приводит email к одному виду для ключа Redis (латиница, нижний регистр).
// Заменяет кириллические буквы-двойники на латинские, чтобы вставка из буфера не ломала ключ.
func normalizeEmailForKey(s string) string {
	const (
		cyrO = '\u043e' // о
		cyrA = '\u0430' // а
		cyrE = '\u0435' // е
		cyrP = '\u0440' // р
		cyrC = '\u0441' // с
		cyrX = '\u0445' // х
		cyrY = '\u0443' // у
	)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range strings.TrimSpace(strings.ToLower(s)) {
		switch r {
		case cyrO:
			b.WriteByte('o')
		case cyrA:
			b.WriteByte('a')
		case cyrE:
			b.WriteByte('e')
		case cyrP:
			b.WriteByte('p')
		case cyrC:
			b.WriteByte('c')
		case cyrX:
			b.WriteByte('x')
		case cyrY:
			b.WriteByte('y')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (s *OTPAuthService) RequestCode(ctx context.Context, req RequestCodeRequest) error {
	emailNorm := strings.TrimSpace(strings.ToLower(req.Email))
	if emailNorm == "" {
		return fmt.Errorf("email обязателен")
	}
	if !emailRegexp.MatchString(emailNorm) {
		return ErrInvalidEmail
	}
	keyEmail := normalizeEmailForKey(emailNorm)
	allowed, err := s.store.CheckRateLimit(ctx, keyEmail)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrRateLimitExceeded
	}
	// Если код уже был запрошен недавно (осталось > 4 мин TTL), переотправляем тот же код — не перезаписываем в Redis.
	const minTTLToReuse = 240 * time.Second
	if existing, _ := s.store.GetOTP(ctx, keyEmail); existing != "" && len(existing) == 6 {
		if ttl, _ := s.store.GetOTPTTL(ctx, keyEmail); ttl >= minTTLToReuse {
			logger.Infof("request-code: переотправка того же кода для key=otp:%s (TTL %.0fs)", keyEmail, ttl.Seconds())
			return s.mailer.SendOTP(ctx, emailNorm, existing)
		}
	}
	code := generateOTP(6)
	if err := s.store.SetOTP(ctx, keyEmail, code); err != nil {
		return err
	}
	logger.Infof("request-code: код сохранён для key=otp:%s", keyEmail)
	return s.mailer.SendOTP(ctx, emailNorm, code)
}

type VerifyCodeRequest struct {
	Email      string `json:"email"`
	Code       string `json:"code"`
	DeviceID   string `json:"device_id"`
	DeviceName string `json:"device_name"` // опционально
}

type VerifyCodeResponse struct {
	SessionID     string `json:"session_id"`
	SessionSecret string `json:"session_secret"`
	IsNewUser     bool   `json:"is_new_user"`
}

func (s *OTPAuthService) VerifyCode(ctx context.Context, req VerifyCodeRequest) (*VerifyCodeResponse, error) {
	emailNorm := strings.TrimSpace(strings.ToLower(req.Email))
	keyEmail := normalizeEmailForKey(emailNorm)
	codeNorm := onlyDigits(strings.TrimSpace(req.Code))
	if emailNorm == "" || codeNorm == "" || req.DeviceID == "" {
		return nil, fmt.Errorf("email, code и device_id обязательны")
	}
	if len(codeNorm) != 6 {
		return nil, ErrInvalidOTP
	}
	storedCode, err := s.store.GetOTP(ctx, keyEmail)
	if err != nil {
		logger.Errorf("verify-code: Redis GetOTP error key=%q err=%v", keyEmail, err)
		return nil, ErrInvalidOTP
	}
	if storedCode == "" {
		logger.Infof("verify-code: ключ otp:%s пуст или истёк (запросите код заново)", keyEmail)
		return nil, ErrInvalidOTP
	}
	// Сравнение constant-time. Код в Redis хранится как 6 цифр, ввод нормализован через onlyDigits.
	if len(storedCode) != 6 || subtle.ConstantTimeCompare([]byte(storedCode), []byte(codeNorm)) != 1 {
		logger.Infof("verify-code: несовпадение key=%s len(stored)=%d len(entered)=%d", keyEmail, len(storedCode), len(codeNorm))
		return nil, ErrInvalidOTP
	}
	// Код верный — удаляем OTP (одноразовое использование).
	if err := s.store.DeleteOTP(ctx, keyEmail); err != nil {
		logger.Errorf("verify-code: DeleteOTP key=%s: %v", keyEmail, err)
	}

	user, err := s.userRepo.GetByEmail(ctx, emailNorm)
	isNewUser := false
	if err != nil {
		if !errors.Is(err, repository.ErrNotFound) {
			return nil, err
		}
		user, err = s.createUserByEmail(ctx, emailNorm)
		if err != nil {
			return nil, err
		}
		isNewUser = true
	}
	if user.DisabledAt != nil {
		return nil, ErrUserDisabled
	}
	sessionID := uuid.New().String()
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, err
	}
	secretB64 := base64.StdEncoding.EncodeToString(secret)
	h := sha256.Sum256(secret)
	secretHash := hex.EncodeToString(h[:])
	now := time.Now().UTC()
	session := &model.Session{
		ID: sessionID, UserID: user.ID, DeviceID: req.DeviceID, DeviceName: strings.TrimSpace(req.DeviceName),
		SecretHash: secretHash, LastSeenAt: now, CreatedAt: now,
	}
	// Сначала upsert (одна операция, нет duplicate key). При ошибке (например старая БД) — fallback: delete + insert.
	if err := s.sessionRepo.UpsertByUserIDAndDeviceID(ctx, session); err != nil {
		logger.Errorf("verify-code: Upsert session failed, fallback to delete+insert: %v", err)
		if delErr := s.sessionRepo.DeleteByUserIDAndDeviceID(ctx, user.ID, req.DeviceID); delErr != nil {
			logger.Errorf("verify-code: DeleteByUserIDAndDeviceID failed: %v", delErr)
			return nil, fmt.Errorf("create session: %w", err)
		}
		if createErr := s.sessionRepo.Create(ctx, session); createErr != nil {
			logger.Errorf("verify-code: Create session failed: %v", createErr)
			return nil, fmt.Errorf("create session: %w", createErr)
		}
	}
	if err := s.store.SetSessionSecret(ctx, sessionID, secretB64); err != nil {
		logger.Errorf("verify-code: SetSessionSecret failed: %v", err)
		if delErr := s.sessionRepo.Delete(ctx, sessionID); delErr != nil {
			logger.Errorf("verify-code: rollback Delete session: %v", delErr)
		}
		return nil, fmt.Errorf("save session secret: %w", err)
	}
	return &VerifyCodeResponse{SessionID: sessionID, SessionSecret: secretB64, IsNewUser: isNewUser}, nil
}

func (s *OTPAuthService) createUserByEmail(ctx context.Context, emailAddr string) (*model.User, error) {
	username := deriveUsername(emailAddr)
	for i := 0; i < 10; i++ {
		try := username
		if i > 0 {
			try = username + "_" + uuid.New().String()[:8]
		}
		if len(try) > 50 {
			try = try[:50]
		}
		_, err := s.userRepo.GetByUsername(ctx, try)
		if errors.Is(err, repository.ErrNotFound) {
			now := time.Now().UTC()
			u := &model.User{
				ID: uuid.New().String(), Username: try, Email: emailAddr, Phone: "",
				PasswordHash: "", LastSeenAt: now, IsOnline: false, CreatedAt: now,
			}
			if err := s.userRepo.Create(ctx, u); err != nil {
				return nil, err
			}
			return u, nil
		}
		if err != nil {
			return nil, err
		}
	}
	return nil, fmt.Errorf("не удалось сгенерировать username")
}

func deriveUsername(emailAddr string) string {
	at := strings.Index(emailAddr, "@")
	if at <= 0 {
		return "user_" + uuid.New().String()[:8]
	}
	local := strings.ReplaceAll(emailAddr[:at], ".", "_")
	if len(local) > 50 {
		local = local[:50]
	}
	if local == "" {
		return "user_" + uuid.New().String()[:8]
	}
	return local
}

func generateOTP(length int) string {
	const digits = "0123456789"
	b := make([]byte, length)
	for i := range b {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(digits))))
		b[i] = digits[n.Int64()]
	}
	return string(b)
}

func hashOTP(code string) string {
	h := sha256.Sum256([]byte(code))
	return hex.EncodeToString(h[:])
}

func (s *OTPAuthService) ListSessions(ctx context.Context, userID string) ([]model.Session, error) {
	return s.sessionRepo.ListByUserID(ctx, userID)
}

func (s *OTPAuthService) LogoutSession(ctx context.Context, userID, sessionID string) (bool, error) {
	ok, err := s.sessionRepo.DeleteByUserIDAndSessionID(ctx, userID, sessionID)
	if err != nil {
		return false, err
	}
	if ok {
		if err := s.store.DeleteSessionSecret(ctx, sessionID); err != nil {
			logger.Errorf("LogoutSession: DeleteSessionSecret session_id=%s: %v", maskSessionID(sessionID), err)
		}
	}
	return ok, nil
}

func (s *OTPAuthService) LogoutAllSessions(ctx context.Context, userID string) (int64, error) {
	ids, err := s.sessionRepo.RevokeByUserID(ctx, userID)
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		if err := s.store.DeleteSessionSecret(ctx, id); err != nil {
			logger.Errorf("LogoutAllSessions: DeleteSessionSecret session_id=%s: %v", maskSessionID(id), err)
		}
	}
	return int64(len(ids)), nil
}

// ValidateRequest проверяет подпись запроса и возвращает user_id. Используется API через POST /internal/validate.
// timestamp — Unix секунды; допустимое отклонение ±30 сек.
func (s *OTPAuthService) ValidateRequest(ctx context.Context, sessionID, timestamp, signature, method, path, body string) (userID string, err error) {
	if sessionID == "" || timestamp == "" || signature == "" {
		logger.Errorf("validate: missing session_id/timestamp/signature")
		return "", ErrInvalidOTP
	}
	ts, err := strconv.ParseInt(timestamp, 10, 64)
	if err != nil {
		return "", ErrInvalidOTP
	}
	t := time.Unix(ts, 0)
	if time.Since(t) > 30*time.Second || time.Until(t) > 30*time.Second {
		logger.Errorf("validate: timestamp out of window session_id=%s", maskSessionID(sessionID))
		return "", ErrInvalidOTP
	}
	secretB64, err := s.store.GetSessionSecret(ctx, sessionID)
	if err != nil || secretB64 == "" {
		logger.Errorf("validate: no session_secret in Redis session_id=%s", maskSessionID(sessionID))
		return "", ErrInvalidOTP
	}
	secret, err := base64.StdEncoding.DecodeString(secretB64)
	if err != nil || len(secret) != 32 {
		return "", ErrInvalidOTP
	}
	tryPath := func(p string) bool {
		pl := method + p + body + timestamp
		mac := hmac.New(sha256.New, secret)
		mac.Write([]byte(pl))
		expected := hex.EncodeToString(mac.Sum(nil))
		return hmac.Equal([]byte(signature), []byte(expected))
	}
	if tryPath(path) {
		// подпись совпала
	} else if strings.HasPrefix(path, "/api/") && tryPath(path[4:]) {
		// клиент подписал path без префикса /api (старый фронт или прокси)
	} else {
		logger.Errorf("validate: signature mismatch path=%q", path)
		return "", ErrInvalidOTP
	}
	sess, err := s.sessionRepo.GetByID(ctx, sessionID)
	if err != nil || sess == nil {
		logger.Errorf("validate: session not found in DB session_id=%s err=%v", maskSessionID(sessionID), err)
		return "", ErrInvalidOTP
	}
	user, err := s.userRepo.GetByID(ctx, sess.UserID)
	if err != nil || user == nil || user.DisabledAt != nil {
		if user != nil && user.DisabledAt != nil {
			logger.Infof("validate: user %s disabled", sess.UserID)
		}
		return "", ErrInvalidOTP
	}
	if err := s.sessionRepo.UpdateLastSeen(ctx, sessionID, time.Now().UTC()); err != nil {
		logger.Errorf("validate: UpdateLastSeen session_id=%s: %v", maskSessionID(sessionID), err)
	}
	return sess.UserID, nil
}
