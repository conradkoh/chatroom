#!/usr/bin/env bash
set -e

# Back-compat alias for local development. The supported workflow is `pnpm dev`
# (turbo: Convex dev + Next.js dev with hot reload).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

if [ ! -f "services/backend/.env.local" ]; then
  echo "First-time setup detected. Running pnpm setup..."
  pnpm setup --skip-branding -y
fi

echo "Starting local development via pnpm dev..."
exec pnpm dev
