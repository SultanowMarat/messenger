package main

import (
	"bytes"
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	embeddedpostgres "github.com/fergusstrange/embedded-postgres"
	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/messenger/internal/config"
	"github.com/messenger/internal/handler"
	"github.com/messenger/internal/logger"
	"github.com/messenger/internal/middleware"
	"github.com/messenger/internal/push"
	"github.com/messenger/internal/repository"
	"github.com/messenger/internal/startup"
	"github.com/messenger/internal/ws"
)

func main() {
	logger.SetPrefix("api")
	migrate := flag.Bool("migrate", false, "run database migrations")
	dev := flag.Bool("dev", false, "start with embedded PostgreSQL (no external DB required)")
	flag.Parse()

	logger.Info("starting API service")
	cfg := config.Load()

	var embeddedDB *embeddedpostgres.EmbeddedPostgres
	if *dev {
		var err error
		embeddedDB, err = startEmbeddedPostgres(cfg)
		if err != nil {
			logger.Errorf("embedded postgres: %v", err)
			os.Exit(1)
		}
		defer func() {
			logger.Info("stopping embedded postgres...")
			if err := embeddedDB.Stop(); err != nil {
				logger.Errorf("embedded postgres stop: %v", err)
			}
		}()
	}

	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL())
	if err != nil {
		logger.Errorf("parse db config: %v", err)
		os.Exit(1)
	}
	poolCfg.MaxConns = int32(cfg.DBMaxConnections())
	poolCfg.MinConns = 4

	pool := startup.ConnectDBWithRetry(poolCfg, 60*time.Second, "")
	defer pool.Close()

	runMigrations(pool)
	if *migrate && !*dev {
		return
	}

	resetCtx, resetCancel := context.WithTimeout(context.Background(), 5*time.Second)
	if _, err := pool.Exec(resetCtx, "UPDATE users SET is_online = false"); err != nil {
		logger.Errorf("reset online status: %v", err)
	}
	resetCancel()
	logger.Info("database connected, migrations applied")

	userRepo := repository.NewUserRepository(pool)
	permRepo := repository.NewPermissionRepository(pool)
	chatRepo := repository.NewChatRepository(pool)
	msgRepo := repository.NewMessageRepository(pool)
	reactRepo := repository.NewReactionRepository(pool)
	pinnedRepo := repository.NewPinnedRepository(pool)
	pushClient := push.NewClient(cfg.PushServiceURL)
	hubCtx, hubCancel := context.WithCancel(context.Background())
	hub := ws.NewHub(chatRepo, msgRepo, userRepo, reactRepo, pinnedRepo, cfg.MaxWSConnections, pushClient)

	var hubWg sync.WaitGroup
	hubWg.Add(1)
	go func() {
		defer hubWg.Done()
		hub.Run(hubCtx)
	}()

	chatH := handler.NewChatHandler(chatRepo, userRepo, msgRepo, hub)
	msgH := handler.NewMessageHandler(msgRepo, chatRepo, reactRepo, pinnedRepo)
	fileH := handler.NewFileHandler(cfg)
	audioH := handler.NewAudioHandler(cfg)
	userH := handler.NewUserHandler(userRepo, msgRepo, permRepo)
	wsH := handler.NewWSHandler(hub, cfg.CORSAllowedOrigins)
	configH := handler.NewConfigHandler(cfg)
	pushH := handler.NewPushHandler(pushClient)

	r := chi.NewRouter()
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(middleware.RecoverJSON)
	// Не сжимать WebSocket — иначе ResponseWriter не реализует http.Hijacker и upgrade даёт 500.
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if strings.EqualFold(req.Header.Get("Upgrade"), "websocket") {
				next.ServeHTTP(w, req)
				return
			}
			chimw.Compress(5)(next).ServeHTTP(w, req)
		})
	})
	r.Use(middleware.RequestLog)
	r.Use(middleware.SecureHeaders)
	r.Use(middleware.RateLimitAPI)
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.CORSAllowedOrigins},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-Session-Id", "X-Timestamp", "X-Signature"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	r.Get("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK); w.Write([]byte("ok")) })
	r.Get("/api/config/cache", configH.GetCacheConfig)
	r.Get("/api/config/push", configH.GetPushConfig)
	r.Get("/api/config/call", configH.GetCallConfig)
	r.Get("/api/files/{filename}", fileH.Serve)
	if audioH != nil {
		r.Get("/api/audio/{filename}", audioH.Serve)
	}

	if cfg.AuthServiceURL != "" {
		authProxy := authProxyHandler(cfg.AuthServiceURL)
		r.Post("/api/auth/request-code", authProxy)
		r.Post("/api/auth/verify-code", authProxy)
	}
	r.Post("/api/auth/register", authLegacyGone)
	r.Post("/api/auth/login", authLegacyGone)
	r.Post("/api/auth/refresh", authLegacyGone)

	// Валидация сессии для микросервиса звонков (query: session_id, timestamp, signature, path)
	if cfg.AuthServiceURL != "" {
		r.Get("/api/call/validate", handler.CallValidate(cfg.AuthServiceURL, nil))
	}

	r.Group(func(r chi.Router) {
		r.Use(middleware.AuthServiceValidate(cfg.AuthServiceURL, nil))
		r.Get("/api/users/me", userH.GetProfile)
		r.Put("/api/users/me", userH.UpdateProfile)
		r.Get("/api/users", userH.GetUsers)
		r.Get("/api/users/employees", userH.GetEmployees)
		r.Post("/api/users", userH.CreateUser)
		r.Get("/api/users/search", userH.SearchUsers)
		r.Get("/api/users/me/favorites", userH.GetFavorites)
		r.Post("/api/users/me/favorites", userH.AddFavorite)
		r.Delete("/api/users/me/favorites/{chatId}", userH.RemoveFavorite)
		r.Get("/api/users/{id}", userH.GetUser)
		r.Put("/api/users/{id}", userH.UpdateUserProfile)
		r.Get("/api/users/{id}/stats", userH.GetUserStats)
		r.Get("/api/users/{id}/permissions", userH.GetUserPermissions)
		r.Put("/api/users/{id}/permissions", userH.UpdateUserPermissions)
		r.Put("/api/users/{id}/disable", userH.SetUserDisabled)
		r.Get("/api/chats", chatH.GetUserChats)
		r.Post("/api/chats/personal", chatH.CreatePersonalChat)
		r.Post("/api/chats/group", chatH.CreateGroupChat)
		r.Get("/api/chats/{id}", chatH.GetChat)
		r.Put("/api/chats/{id}", chatH.UpdateChat)
		r.Post("/api/chats/{id}/members", chatH.AddMembers)
		r.Delete("/api/chats/{id}/members/{memberId}", chatH.RemoveMember)
		r.Post("/api/chats/{id}/leave", chatH.LeaveChat)
		r.Get("/api/chats/{chatId}/messages", msgH.GetMessages)
		r.Post("/api/chats/{chatId}/read", msgH.MarkAsRead)
		r.Get("/api/chats/{chatId}/pinned", msgH.GetPinnedMessages)
		r.Get("/api/messages/{messageId}/reactions", msgH.GetReactions)
		r.Get("/api/messages/search", msgH.SearchMessages)
		r.Post("/api/files/upload", fileH.Upload)
		if audioH != nil {
			r.Post("/api/audio/upload", audioH.Upload)
		} else {
			r.Post("/api/audio/upload", func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Content-Type", "application/json; charset=utf-8")
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(map[string]string{"error": "audio service not configured"})
			})
		}
		r.Post("/api/push/subscribe", pushH.Subscribe)
		r.Delete("/api/push/subscribe", pushH.Unsubscribe)
		r.Get("/ws", wsH.ServeWS)
	})

	webDist := "./web/dist"
	if info, err := os.Stat(webDist); err == nil && info.IsDir() {
		r.Get("/*", spaHandler(webDist))
	}

	srv := &http.Server{
		Addr:         cfg.ServerAddr,
		Handler:      r,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}

	var srvWg sync.WaitGroup
	errCh := make(chan error, 1)
	srvWg.Add(1)
	go func() {
		defer srvWg.Done()
		logger.Infof("server listening on %s", cfg.ServerAddr)
		errCh <- srv.ListenAndServe()
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	select {
	case <-quit:
		logger.Info("shutdown signal received")
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			logger.Errorf("server error: %v", err)
			os.Exit(1)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logger.Errorf("server shutdown: %v", err)
	}
	logger.Info("server stopped accepting connections")
	hubCancel()
	hubWg.Wait()
	logger.Info("hub stopped")
	srvWg.Wait()
	logger.Info("server goroutine exited")
}

func authLegacyGone(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusGone)
	const msg = `{"error":"Вход по паролю отключён. Используется вход по коду на email. Обновите страницу (Ctrl+F5) или пересоберите фронт: cd web && npm run build"}`
	w.Write([]byte(msg))
}

func authProxyHandler(authBaseURL string) http.HandlerFunc {
	client := &http.Client{Timeout: 15 * time.Second}
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"error":"bad request"}`, http.StatusBadRequest)
			return
		}
		targetURL := strings.TrimSuffix(authBaseURL, "/") + r.URL.Path
		proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, targetURL, bytes.NewReader(body))
		if err != nil {
			http.Error(w, `{"error":"internal"}`, http.StatusInternalServerError)
			return
		}
		proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))
		if proxyReq.Header.Get("Content-Type") == "" {
			proxyReq.Header.Set("Content-Type", "application/json")
		}
		resp, err := client.Do(proxyReq)
		if err != nil {
			logger.Errorf("auth proxy: %v", err)
			http.Error(w, `{"error":"auth service unavailable"}`, http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		w.Header().Set("Content-Type", resp.Header.Get("Content-Type"))
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	}
}

func spaHandler(dir string) http.HandlerFunc {
	fs := http.Dir(dir)
	fileServer := http.FileServer(fs)
	return func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(filepath.Clean(r.URL.Path), "/")
		if path == "" {
			path = "index.html"
		}
		if f, err := fs.Open(path); err != nil {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
		} else {
			f.Close()
			fileServer.ServeHTTP(w, r)
		}
	}
}

func runMigrations(pool *pgxpool.Pool) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	files := []string{
		"migrations/001_init.sql", "migrations/002_features.sql", "migrations/003_phone.sql",
		"migrations/004_system_messages.sql", "migrations/005_user_favorites.sql", "migrations/006_notes_chat.sql",
		"migrations/007_sessions_otp_auth.sql", "migrations/008_sessions_revoked_at.sql",
		"migrations/010_user_permissions.sql", "migrations/011_user_permissions_administrator.sql", "migrations/012_user_permissions_member.sql",
		"migrations/013_normalize_file_names.sql", "migrations/014_allow_voice_content_type.sql",
		"migrations/015_user_disabled_at.sql",
	}
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err != nil {
			logger.Errorf("read migration %s: %v", f, err)
			os.Exit(1)
		}
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			logger.Errorf("run migration %s: %v", f, err)
			os.Exit(1)
		}
	}
	logger.Info("migrations applied")
}

func startEmbeddedPostgres(cfg *config.Config) (*embeddedpostgres.EmbeddedPostgres, error) {
	const (
		port     = 5432
		user     = "messenger"
		password = "messenger_secret"
		database = "messenger"
	)

	dataDir := filepath.Join(".", ".pgdata")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create pgdata dir: %w", err)
	}

	db := embeddedpostgres.NewDatabase(
		embeddedpostgres.DefaultConfig().
			Port(port).
			Username(user).
			Password(password).
			Database(database).
			DataPath(dataDir).
			RuntimePath(filepath.Join(os.TempDir(), "embedded-pg-runtime")),
	)

	logger.Info("starting embedded PostgreSQL...")
	if err := db.Start(); err != nil {
		return nil, fmt.Errorf("start: %w", err)
	}

	cfg.Database.URL = fmt.Sprintf(
		"postgres://%s:%s@localhost:%d/%s?sslmode=disable",
		user, password, port, database,
	)
	logger.Infof("embedded PostgreSQL running on port %d", port)
	return db, nil
}
