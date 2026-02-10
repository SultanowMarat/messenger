#!/bin/sh
# Проверка окружения для развёртывания: Docker, .env, docker compose config.
set -e
cd "$(dirname "$0")/.."
echo "=== Docker ==="
if ! command -v docker >/dev/null 2>&1; then
  echo "Ошибка: Docker не установлен. Развёртывание только через Docker Compose."
  echo "  См. docs/install/INSTALL_DOCKER.md"
  exit 1
fi
docker --version
if ! docker compose version >/dev/null 2>&1; then
  echo "Ошибка: docker compose не найден."
  exit 1
fi
echo "docker compose: OK"
echo ""
echo "=== Конфиг ==="
if [ ! -f .env ]; then
  echo "ВНИМАНИЕ: .env не найден. Выполните: cp services/infra/.env.example .env"
else
  echo ".env найден"
  grep -q SMTP_USERNAME .env && echo "  SMTP_USERNAME задан" || true
  grep -q CORS_ALLOWED_ORIGINS .env && echo "  CORS_ALLOWED_ORIGINS задан" || true
fi
echo ""
echo "=== docker compose config ==="
docker compose config -q && echo "OK" || { echo "Ошибка в docker-compose.yml или .env"; exit 1; }
echo ""
echo "Готово. Запуск: docker compose up -d --build"
