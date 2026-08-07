#!/usr/bin/env bash
# Manually run the scheduled-prompts cron tick (runDue) on the current Convex dev deployment.
#
# Usage:
#   ./scripts/trigger-scheduled-prompts-run-due.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR/services/backend"

echo "Triggering scheduledPrompts:runDue ..."
npx convex run scheduledPrompts:runDue '{}'
echo "Done. Re-run investigate-scheduled-prompt.sh to see updated state."
