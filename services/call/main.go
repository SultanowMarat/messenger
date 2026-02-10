// Микросервис аудиозвонков (сигнализация WebRTC, как в Telegram).
package main

import (
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimw "github.com/go-chi/chi/v5/middleware"

	"github.com/messenger/internal/callserver"
	"github.com/messenger/internal/logger"
)

func main() {
	logger.SetPrefix("call")
	apiURL := os.Getenv("API_URL")
	if apiURL == "" {
		apiURL = "http://localhost:8080"
	}
	addr := os.Getenv("SERVER_ADDR")
	if addr == "" {
		addr = ":8085"
	}
	logger.Infof("starting call service: api_url=%s addr=%s", apiURL, addr)

	validate := callserver.ValidateViaHTTP(apiURL, &http.Client{Timeout: 5 * time.Second})
	hub := callserver.NewHub(validate)

	r := chi.NewRouter()
	r.Use(chimw.RealIP)
	r.Use(chimw.Logger)
	r.Use(chimw.Recoverer)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusOK); w.Write([]byte("ok")) })
	r.Get("/call/ws", hub.ServeWS)

	srv := &http.Server{Addr: addr, Handler: r, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second}
	go func() {
		logger.Infof("call service listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Errorf("call: %v", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	logger.Info("call service shutting down")
	srv.Close()
	logger.Info("call service stopped")
}
