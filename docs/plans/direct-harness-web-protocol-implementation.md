# Direct Harness — Web Protocol Implementation Plan

**Status:** Planned
**Date:** 2026-05-04

---

## Overview

Replace the 3-step submit/claim/complete prompt lifecycle with direct message streaming.
Delete `chatroom_pendingPrompts` table. Daemon subscribes to sessions + messages directly.

## Order of Work

### Layer 1: CLI Domain (ports)

| Step | File | Action |
|------|------|--------|
| 1 | `packages/cli/src/domain/direct-harness/ports/prompt-repository.ts` | Delete entire file — no more prompt lifecycle |
| 2 | `packages/cli/src/domain/direct-harness/ports/session-repository.ts` | Add `updateLastProcessedSeq(sessionRowId, seq): Promise<void>` method |
| 3 | `packages/cli/src/domain/direct-harness/ports/index.ts` | Remove `PromptRepository` / `PromptOverride` exports |

### Layer 2: CLI Use Cases

| Step | File | Action |
|------|------|--------|
| 4 | `packages/cli/src/domain/direct-harness/usecases/prompt-session.ts` | Delete entire file |
| 5 | `packages/cli/src/domain/direct-harness/usecases/prompt-session.test.ts` | Delete entire file |
| 6 | `packages/cli/src/domain/direct-harness/usecases/index.ts` | Remove `promptSession` export |
| 7 | `packages/cli/src/domain/direct-harness/index.ts` | Remove `PromptRepository` + `promptSession` exports |

### Layer 3: CLI App Layer (infrastructure + daemon)

| Step | File | Action |
|------|------|--------|
| 8 | `packages/cli/src/infrastructure/repos/convex-prompt-repository.ts` | Delete entire file |
| 9 | `packages/cli/src/infrastructure/repos/convex-prompt-repository.test.ts` | Delete entire file |
| 10 | `packages/cli/src/infrastructure/repos/convex-session-repository.ts` | Add `updateLastProcessedSeq()` — calls new `sessions.updateCursor` mutation |
| 11 | `packages/cli/src/infrastructure/repos/index.ts` | Remove `ConvexPromptRepository` / `ConvexPromptRepositoryOptions` exports |
| 12 | `packages/cli/src/commands/machine/daemon-start/v2/prompt-subscriber.ts` | Rewrite → message subscriber. Subscribe to `messages.pendingForMachine(machineId)`. For each batch of user messages: resolve session handle (lazy resume if needed), call `session.prompt()`, update `lastProcessedSeq` via `sessions.updateCursor`. No `PromptRepository` dep. |
| 13 | `packages/cli/src/commands/machine/daemon-start/v2/session-subscriber.ts` | Remove first-prompt claiming block. Remove `PromptRepository` dep. Just boot → open → associate → wire journal. |
| 14 | `packages/cli/src/commands/machine/daemon-start/command-loop.ts` | Remove `ConvexPromptRepository` import + wiring. `promptRepository` field gone from sharedDeps. |

### Layer 4: Backend Schema

| Step | File | Action |
|------|------|--------|
| 15 | `services/backend/convex/schema.ts` | Add `role: v.union(v.literal('user'), v.literal('assistant'))` to `chatroom_harnessSessionMessages` |
| 16 | `services/backend/convex/schema.ts` | Add index `.index('by_session_role_seq', ['harnessSessionRowId', 'role', 'seq'])` on messages table |
| 17 | `services/backend/convex/schema.ts` | Add `lastProcessedSeq: v.number()` (default 0) to `chatroom_harnessSessions` |
| 18 | `services/backend/convex/schema.ts` | Delete `chatroom_pendingPrompts` table definition |

### Layer 5: Backend Endpoints

Endpoints split into frontend-facing and daemon-facing files for clarity.

#### Frontend-facing (new `frontend/` directory)

| Step | File | Action |
|------|------|--------|
| 19 | `directHarness/frontend/sessions.ts` | **Add** `sessions.create` mutation |
| 20 | `directHarness/frontend/sessions.ts` | Move `closeSession` here |
| 21 | `directHarness/frontend/messages.ts` | **Add** `messages.send` mutation |
| 22 | `directHarness/frontend/messages.ts` | **Add** `messages.subscribe` query |

#### Daemon-facing (new `daemon/` directory)

| Step | File | Action |
|------|------|--------|
| 23 | `directHarness/daemon/sessions.ts` | Move `associateHarnessSessionId`, `listPendingSessionsForMachine` here |
| 24 | `directHarness/daemon/sessions.ts` | **Add** `sessions.updateCursor` mutation |
| 25 | `directHarness/daemon/messages.ts` | Move `appendMessages` here, update to hard-code `role='assistant'` |
| 26 | `directHarness/daemon/messages.ts` | **Add** `messages.pendingForMachine` query |

#### Cleanup (delete deprecated)

| Step | File | Action |
|------|------|--------|
| 27 | `directHarness/sessions.ts` | Delete entire file (openSession, updateSessionConfig, getSession, listSessionsByWorkspace) |
| 28 | `directHarness/messages.ts` | Delete entire file (streamSessionMessages) |
| 29 | `directHarness/prompts.ts` | Delete entire file |
| 30 | `directHarness/capabilities.ts` | Delete `listForWorkspace`, `requestRefresh` |
| 31 | `directHarness/index.ts` | Update barrel exports |
| 32 | Backend tests | Update integration tests |

### Frontend (separate)

| Step | File | Action |
|------|------|--------|
| 35 | `apps/webapp/src/modules/chatroom/direct-harness/` | Update to call `sessions.create`, `messages.send`, `messages.subscribe`. Remove old endpoint calls. |

## Endpoint Summary After Changes

### Frontend-facing (new)

| Endpoint | Type | Purpose |
|----------|------|---------|
| `sessions.create` | mutation | Create session + first message |
| `sessions.closeSession` | mutation | Close session (unchanged) |
| `messages.send` | mutation | Append user message |
| `messages.subscribe` | query | Cursor-based delta stream |
| `capabilities.listForWorkspace` | query | Keep (still needed for form) |

### Daemon-facing (new + existing)

| Endpoint | Type | Purpose |
|----------|------|---------|
| `sessions.listPendingSessionsForMachine` | query | New session detection (unchanged) |
| `sessions.associateHarnessSessionId` | mutation | SDK session association (unchanged) |
| `sessions.closeSession` | mutation | Mark closed (unchanged) |
| `sessions.updateCursor` | mutation | Persist lastProcessedSeq |
| `messages.appendMessages` | mutation | Write response chunks (unchanged, +role) |
| `messages.pendingForMachine` | query | Fetch unprocessed user messages |
| `capabilities.publishMachineCapabilities` | mutation | Publish capabilities (unchanged) |
| `capabilities.completeRefreshTask` | mutation | Refresh task (unchanged) |
| `capabilities.getPendingRefreshTasksForMachine` | query | Refresh task polling (unchanged) |

### Deleted

| Endpoint | Reason |
|----------|--------|
| `sessions.openSession` | Replaced by `sessions.create` |
| `sessions.updateSessionConfig` | Config is passed with each message |
| `sessions.getSession` | No longer needed |
| `sessions.listSessionsByWorkspace` | No longer needed |
| `messages.streamSessionMessages` | Replaced by `messages.subscribe` |
| `prompts.submitPrompt` | Replaced by `messages.send` |
| `prompts.claimNextPendingPrompt` | No prompt lifecycle |
| `prompts.completePendingPrompt` | No prompt lifecycle |
| `prompts.getPendingPromptsForMachine` | Replaced by `messages.pendingForMachine` |
| `capabilities.requestRefresh` | Capabilities auto-published on boot |
