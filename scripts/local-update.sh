#!/usr/bin/env bash
set -e

# Pull latest code, install deps, then start dev (replaces old production rebuild flow).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

echo "Stopping any legacy local processes..."
bash "$SCRIPT_DIR/local-stop.sh"
echo ""

echo "Pulling latest changes..."
git pull
echo ""

echo "Installing dependencies..."
pnpm install
echo ""

echo "Starting local development via pnpm dev..."
exec pnpm dev
