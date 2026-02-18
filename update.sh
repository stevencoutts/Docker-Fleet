#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required but was not found." >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "Docker Compose is required but was not found (tried 'docker compose' and 'docker-compose')." >&2
  exit 1
fi

echo "==> Updating repo (branch: main)"
git fetch --prune
git checkout main
git pull --rebase

echo "==> Rebuilding images"
"${COMPOSE_CMD[@]}" build

echo "==> Recreating containers"
"${COMPOSE_CMD[@]}" up -d --force-recreate --remove-orphans

echo "==> Done"
