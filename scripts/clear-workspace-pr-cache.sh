#!/usr/bin/env bash
# Clears chatroom_workspacePRDiffs and chatroom_workspacePRCommits (daemon repopulates on demand).
# Use when legacy rows lack `prNumber` and local `convex dev` schema validation fails.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/services/backend"
pnpm exec convex run devWorkspaceGitCleanup:deleteAllWorkspacePRDiffs --push
pnpm exec convex run devWorkspaceGitCleanup:deleteAllWorkspacePRCommits --push
