# Messenger

Высокопроизводительный мессенджер на Go с WebSocket чатом, доставкой сообщений, медиа и звонками (WebRTC). Проект разворачивается через Docker Compose и включает отдельные сервисы для аутентификации, сообщений, файлов, пушей и звонков.

## Состав сервисов
- `frontend` — веб‑клиент (Nginx + статические файлы)
- `nginx` — публичный reverse‑proxy
- `api` — основной HTTP/WebSocket API
- `auth` — аутентификация и сессии
- `files` — загрузка/выдача файлов
- `push` — push‑уведомления
- `audio` — аудиофункции
- `call` — сигналинг звонков (WebRTC)
- `postgres` — база данных
- `redis` — кэш/сессии

## Быстрый старт

1. Проверьте переменные окружения в `.env` (пример значений — `services/infra/.env.example`).
2. Запустите стек:

```bash
make up
```

Остановка:

```bash
make down
```

Перезапуск:

```bash
make restart
```

Проверка окружения:

```bash
make check
```

Полный сброс данных (DEV):

```bash
make reset
```

## Звонки (WebRTC)

ICE‑серверы задаются через переменную окружения `CALL_ICE_SERVERS` в JSON формате. Пример:

```bash
CALL_ICE_SERVERS='[
  {"urls": ["stun:stun.l.google.com:19302"]},
  {"urls": ["turn:turn.example.com:3478"], "username": "user", "credential": "pass"}
]'
```

Клиент получает конфигурацию через `/api/config/call`.

## Документация

Основные документы находятся в каталоге `docs/`:
- `docs/README.md`
- `docs/DEPLOY.md`
- `docs/GO_AGENT_RULES.md`

## Деплой

Скрипты деплоя находятся в `tools/deploy/`. Рекомендуемые сценарии — в `docs/DEPLOY.md`.

---

Если нужно обновить README или добавить разделы (архитектура, API, схемы БД) — скажите, допишу.
