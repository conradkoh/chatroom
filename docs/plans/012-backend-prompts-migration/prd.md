# Plan 012: PRD - Backend Prompts Migration

## Problem Statement

Currently, agent initialization prompts are split between:
1. **Webapp** (`apps/webapp/src/modules/chatroom/prompts/init/`) - Static init prompts compiled into frontend
2. **Backend** (`services/backend/convex/prompts/`) - Dynamic role prompts via API

This split causes issues:
- **Webapp prompts require frontend rebuild** - Can't update init prompts without redeploying webapp
- **CLI has no access to webapp prompts** - CLI only gets backend prompts
- **Inconsistent updates** - Prompt changes require coordinating multiple deployments

## Solution

Move all prompts to the backend (Convex), creating a single source of truth:
- Backend generates complete agent prompts
- CLI fetches prompts via API
- Prompt updates deploy instantly (Convex hot reload)

## User Stories

### Agent Developer
> As an agent developer, I want to update agent prompts and see changes immediately, so I don't have to rebuild and redeploy the frontend.

### System Admin
> As a system admin, I want all prompts in one place, so I can audit and update agent instructions consistently.

### CLI User
> As a CLI user, I want the same prompts as the web UI, so agents behave consistently regardless of interface.

## Requirements

### Functional
1. Backend serves complete agent init prompts via `getInitPrompt` API
2. CLI calls `getInitPrompt` when agent first joins chatroom
3. Prompt updates in backend deploy instantly (no CLI update needed)
4. Fallback to local prompts if backend unavailable

### Non-Functional
1. Prompt generation < 100ms latency
2. No breaking changes to existing CLI versions
3. Backward compatible API

## Success Metrics

| Metric | Target |
|--------|--------|
| Prompt update time | < 1 minute (backend deploy) |
| API latency | < 100ms |
| CLI compatibility | 100% backward compatible |

## Timeline

| Phase | Duration | Description |
|-------|----------|-------------|
| Phase 1 | 2-3 hours | Backend infrastructure |
| Phase 2 | 1-2 hours | CLI integration |
| Phase 3 | 1 hour | Webapp cleanup |
| **Total** | **4-6 hours** | Complete migration |

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Backend API failure | CLI can't get prompts | Fallback to local prompts |
| Prompt regression | Agents behave incorrectly | Test prompts before deploy |
| Breaking CLI change | Old CLIs fail | Version API, maintain compatibility |
