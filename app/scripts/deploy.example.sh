#!/usr/bin/env bash
# Deploy local app/ to a remote server and restart via pm2.
#
# Copy this file to scripts/deploy.sh and fill in SSH_TARGET / REMOTE_DIR / PM2_APP.
# scripts/deploy.sh is gitignored so your real server details stay out of the repo.
#
# Usage:
#   ./scripts/deploy.sh              # rsync code + build + restart
#   ./scripts/deploy.sh --schema     # also: prisma db push (creates new tables)
#   ./scripts/deploy.sh --reseed     # also: wipe-data + seed (DESTRUCTIVE — preserves users only)
#   ./scripts/deploy.sh --schema --reseed

set -euo pipefail

# --- Config (EDIT THESE) ---
SSH_TARGET="root@YOUR.SERVER.IP"
REMOTE_DIR="/var/www/accounting"
PM2_APP="books"
APP_PORT="3200"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_DIR/.." && pwd)"
LOCAL_DATA_DIR="$REPO_ROOT/data"

DO_SCHEMA=0
DO_RESEED=0
for arg in "$@"; do
  case "$arg" in
    --schema) DO_SCHEMA=1 ;;
    --reseed) DO_RESEED=1 ;;
    -h|--help) sed -n '1,40p' "$0"; exit 0 ;;
    *) echo "Unknown flag: $arg"; exit 2 ;;
  esac
done

echo "==> Local typecheck"
( cd "$APP_DIR" && npx tsc --noEmit )

echo "==> Rsync app/ -> $SSH_TARGET:$REMOTE_DIR"
rsync -az --human-readable \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'tsconfig.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude 'src/generated' \
  "$APP_DIR/" "$SSH_TARGET:$REMOTE_DIR/"

if [[ "$DO_RESEED" -eq 1 ]]; then
  if [[ -d "$LOCAL_DATA_DIR" ]]; then
    echo "==> Rsync data/ -> $SSH_TARGET:$REMOTE_DIR/data/"
    rsync -az --human-readable "$LOCAL_DATA_DIR/" "$SSH_TARGET:$REMOTE_DIR/data/"
  else
    echo "!! Cannot reseed: $LOCAL_DATA_DIR not found" >&2
    exit 1
  fi
fi

echo "==> Remote: prisma generate"
ssh "$SSH_TARGET" "cd $REMOTE_DIR && npx prisma generate 2>&1 | tail -3"

if [[ "$DO_SCHEMA" -eq 1 ]]; then
  echo "==> Remote: prisma db push (additive schema sync)"
  ssh "$SSH_TARGET" "cd $REMOTE_DIR && npx prisma db push 2>&1 | tail -10"
fi

if [[ "$DO_RESEED" -eq 1 ]]; then
  echo "==> Remote: wipe-data (preserves users)"
  ssh "$SSH_TARGET" "cd $REMOTE_DIR && npx tsx scripts/wipe-data.ts 2>&1 | tail -15"
  echo "==> Remote: seed"
  ssh "$SSH_TARGET" "cd $REMOTE_DIR && npx tsx scripts/seed.ts 2>&1 | tail -10"
fi

echo "==> Remote: npm run build"
ssh "$SSH_TARGET" "cd $REMOTE_DIR && npm run build 2>&1 | tail -8"

echo "==> Remote: pm2 restart $PM2_APP"
ssh "$SSH_TARGET" "pm2 restart $PM2_APP 2>&1 | grep -E '$PM2_APP|✓' | head -3"

echo "==> Health check"
sleep 1
ssh "$SSH_TARGET" "curl -s -o /dev/null -w 'login=%{http_code} dashboard=%{http_code}\n' http://localhost:$APP_PORT/login http://localhost:$APP_PORT/dashboard"

echo "==> Done."
