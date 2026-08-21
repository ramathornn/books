#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: 'docker compose' (v2) not available. Update Docker to a version with Compose v2." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Error: node not found. Install Node.js 20+: https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Error: Node 20+ required (found $(node -v))." >&2
  exit 1
fi

if [ ! -f "$ROOT_DIR/docker-compose.yml" ]; then
  echo "Error: docker-compose.yml not found at $ROOT_DIR." >&2
  exit 1
fi

echo "==> Starting Postgres + Redis"
docker compose up -d

echo "==> Waiting for Postgres to accept connections"
for i in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U books -d books >/dev/null 2>&1; then
    echo "    Postgres is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "Error: Postgres did not become ready in 60s. Check 'docker compose logs postgres'." >&2
    exit 1
  fi
  sleep 1
done

echo "==> Installing npm dependencies"
cd "$ROOT_DIR/app"
npm install

echo "==> Running the setup wizard"
npx tsx scripts/setup.ts

echo ""
echo "All set! Start the dev server: cd app && npm run dev"
