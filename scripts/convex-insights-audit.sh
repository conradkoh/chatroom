#!/usr/bin/env bash
# Run Convex deployment insights for auditing OCC / resource issues.
# Skips gracefully when cloud auth or deployment is unavailable (local dev).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/backend"

if ! command -v npx >/dev/null 2>&1; then
  echo "convex insights: skipped (npx not found)"
  exit 0
fi

if ! npx convex insights --details 2>/tmp/convex-insights.err; then
  echo "convex insights: skipped ($(head -1 /tmp/convex-insights.err 2>/dev/null || echo 'requires cloud deployment auth'))"
  exit 0
fi
