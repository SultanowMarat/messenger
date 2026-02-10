package handler

import (
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/messenger/internal/config"
	"github.com/messenger/internal/fileserver"
)

type FileHandler struct {
	cfg        *config.Config
	fileSvc    *fileserver.Service
	fileClient *http.Client
	fileBase   string
}

func NewFileHandler(cfg *config.Config) *FileHandler {
	h := &FileHandler{cfg: cfg}
	if cfg.FileServiceURL == "" {
		h.fileSvc = fileserver.New(cfg.UploadDir, cfg.MaxUploadSize)
	} else {
		h.fileClient = &http.Client{Timeout: 60 * time.Second}
		h.fileBase = strings.TrimSuffix(cfg.FileServiceURL, "/")
	}
	return h
}

type FileUploadResponse struct {
	URL         string `json:"url"`
	FileName    string `json:"file_name"`
	FileSize    int64  `json:"file_size"`
	ContentType string `json:"content_type"`
}

func (h *FileHandler) Upload(w http.ResponseWriter, r *http.Request) {
	if h.fileSvc != nil {
		r.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxUploadSize)
		h.fileSvc.Upload(w, r)
		return
	}
	// Прокси на микросервис файлов (Content-Length обязателен для корректного парсинга multipart)
	proxyURL := h.fileBase + "/upload"
	proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, proxyURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	proxyReq.Header.Set("Content-Type", r.Header.Get("Content-Type"))
	proxyReq.Body = http.MaxBytesReader(w, r.Body, h.cfg.MaxUploadSize)
	if r.ContentLength > 0 {
		proxyReq.ContentLength = r.ContentLength
	}
	resp, err := h.fileClient.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "file service unavailable")
		return
	}
	defer resp.Body.Close()
	for k, v := range resp.Header {
		if strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Content-Type") ||
			strings.EqualFold(k, "Content-Disposition") {
			w.Header()[k] = v
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}

func (h *FileHandler) Serve(w http.ResponseWriter, r *http.Request) {
	filename := filepath.Base(chi.URLParam(r, "filename"))
	if h.fileSvc != nil {
		h.fileSvc.Serve(w, r, filename)
		return
	}
	// Прокси GET на микросервис файлов
	rawQuery := ""
	if name := r.URL.Query().Get("name"); name != "" {
		rawQuery = "name=" + url.QueryEscape(name)
	}
	proxyURL := h.fileBase + "/files/" + url.PathEscape(filename)
	if rawQuery != "" {
		proxyURL += "?" + rawQuery
	}
	proxyReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, proxyURL, nil)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}
	resp, err := h.fileClient.Do(proxyReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "file service unavailable")
		return
	}
	defer resp.Body.Close()
	for k, v := range resp.Header {
		if strings.EqualFold(k, "Content-Length") || strings.EqualFold(k, "Content-Type") ||
			strings.EqualFold(k, "Content-Disposition") {
			w.Header()[k] = v
		}
	}
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
