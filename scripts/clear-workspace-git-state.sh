#!/usr/bin/env bash
# Clears all chatroom_workspaceGitState rows in the targeted Convex deployment.
# Use on local dev after legacy PR rows (GitHub `number` only) broke schema validation.
# Daemon will repopulate git state on the next heartbeat.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/backend"
exec pnpm exec convex run devWorkspaceGitCleanup:deleteAllWorkspaceGitState --push
