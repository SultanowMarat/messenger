# Мессенджер

Высокопроизводительный корпоративный мессенджер: Go‑бэкенд, React‑фронтенд, PostgreSQL, Redis, WebSocket.

---

## Быстрый старт (Docker Compose)

```bash
cp services/infra/.env.example .env
# заполните SMTP_* и CORS_ALLOWED_ORIGINS

docker compose up -d --build
```

Доступ:
- https://localhost (nginx + SSL)
- http://localhost (редирект на HTTPS)

Остановка:

```bash
docker compose down
```

Данные и логи:
- данные: `./data/`
- логи сервисов: `services/<service>/logs/`

---

## Документация

- `DEPLOY.md` — деплой на сервер (локальный файл, в `.gitignore`)
- `BUILD_LINUX_SERVER.md` — сборка под linux/amd64 и кеш Buildx
- `INFRA_README.md` — Postgres/Redis и `.env`
- `MACOS_README.md` — сборка и запуск macOS клиента
- `GO_AGENT_RULES.md` — правила разработки Go

---

## Архитектура (кратко)

- **API** (`services/api`) — чаты, сообщения, WebSocket
- **Auth** (`services/auth`) — OTP, сессии
- **Files/Audio/Call/Push** — отдельные микросервисы
- **Frontend** (`services/frontend`) — SPA (React)
- **Nginx** (`services/nginx`) — reverse proxy и SSL

---

## Примечания

- Проект запускается **только через Docker Compose**.
- Для сервера используйте сборку **linux/amd64**.
