# Agent Config System Refactoring Plan

> **Branch**: `feat/tight-team-integration`
> **PR**: #55
> **Last updated**: 2026-03-09

---

## Problem Statement

The agent configuration system has grown organically across three tables (`chatroom_teamAgentConfigs`, `chatroom_machineAgentConfigs`, `chatroom_agentPreferences`) with the frontend directly consuming raw table records and merging them client-side. This causes:

1. **Stale data**: `machineAgentConfigs` and `agentPreferences` are not purged on team switch, leading to ghost roles
2. **Leaky abstractions**: Machine internals (PIDs, machineIds) leak into UI components
3. **Fragile stop/start reasons**: Two incompatible naming conventions (`kebab-case` vs `actor.dot` notation) across backend events and CLI daemon
4. **Redundant queries**: Frontend fetches raw configs and re-derives state that the backend should compute

---

## Phase 1: Backend Use Cases + updateTeam Refactor — DONE

**Status**: Merged into PR #55

### 1a. `getAgentStatusForChatroom` use case

- **File**: `services/backend/src/domain/usecase/agent/get-agent-status-for-chatroom.ts`
- **Purpose**: Role-centric agent status view merging team + machine configs
- **Returns**: `ChatroomAgentStatus` with `AgentRoleView[]` and `WorkspaceView[]` — no raw table records
- **Tests**: 8 tests in `tests/integration/get-agent-status-for-chatroom.spec.ts`

### 1b. `getAgentConfigForStart` use case

- **File**: `services/backend/src/domain/usecase/agent/get-agent-config-for-start.ts`
- **Purpose**: Populate "Start Agent" form with defaults from preference → teamConfig → machineConfig chain
- **Returns**: `AgentStartFormData` with `ConnectedMachineView[]` and `AgentStartDefaults`
- **Tests**: 5 tests in `tests/integration/get-agent-config-for-start.spec.ts`

### 1c. `listChatroomAgentOverview` use case

- **File**: `services/backend/src/domain/usecase/agent/list-chatroom-agent-overview.ts`
- **Purpose**: Per-chatroom agent status summary for sidebar, no machine IDs exposed
- **Returns**: `ChatroomAgentOverview[]` with `agentStatus` and `runningRoles`
- **Tests**: 4 tests in `tests/integration/list-chatroom-agent-overview.spec.ts`

### 1d. `updateTeam` use case (refactored)

- **File**: `services/backend/src/domain/usecase/team/update-team.ts`
- **Purpose**: Event-driven team switch cleanup
- **Behavior**:
  - Deletes `chatroom_teamAgentConfigs` (platform-owned, recreated on restart)
  - Preserves `chatroom_machineAgentConfigs` (machine daemon is single writer)
  - Preserves `chatroom_agentPreferences` (harmless UI hints)
  - Dispatches `agent.requestStop` events for running agents from both teamConfig and machineConfig paths
- **Tests**: 5 unit + 6 integration tests

---

## Phase 2: Unify Start/Stop Reason Types — DONE

**Status**: Implemented
**Goal**: Single source of truth for stop/start reasons in `domain/entities/agent.ts`, referenced everywhere. Unified actor-prefixed dot notation.

### Step 1: Update domain entities (source of truth)

**File**: `services/backend/src/domain/entities/agent.ts`

```
Old types:
  StartAgentReason = 'user-start' | 'user-restart' | 'ensure-agent-retry' | 'test'
  StopAgentReason  = 'user-stop'  | 'dedup-stop'   | 'team-switch'        | 'test'

New types:
  AgentStartReason = 'user.start' | 'user.restart' | 'platform.ensure_agent' | 'test'
  AgentStopReason  = 'user.stop'  | 'platform.dedup' | 'platform.team_switch' | 'daemon.respawn' | 'test'
```

Also export Convex validators (`agentStartReasonValidator`, `agentStopReasonValidator`) for schema use.

### Step 2: Update schema validators

**File**: `services/backend/convex/schema.ts`

Import validators from `domain/entities/agent.ts` and use them in:

- `agent.requestStart` event → `reason` field
- `agent.requestStop` event → `reason` field
- `agent.exited` event → `stopReason` field (currently `v.optional(v.string())`)

Single declaration, referenced across all event tables.

### Step 3: Update backend consumers

| File                                                     | Change                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `src/domain/usecase/agent/start-agent.ts`                | `StartAgentReason` → `AgentStartReason`                                               |
| `src/domain/usecase/agent/stop-agent.ts`                 | `StopAgentReason` → `AgentStopReason`                                                 |
| `src/domain/usecase/team/update-team.ts`                 | `'team-switch'` → `'platform.team_switch'`                                            |
| `src/domain/usecase/agent/ensure-only-agent-for-role.ts` | `'dedup-stop'` → `'platform.dedup'`                                                   |
| `convex/machines.ts` (sendCommand)                       | `'user-start'` → `'user.start'`, `'user-stop'` → `'user.stop'`                        |
| `convex/ensureAgentHandler.ts`                           | `'ensure-agent-retry'` → `'platform.ensure_agent'`, update circuit breaker exclusions |
| `src/events/agent/on-agent-exited.ts`                    | Add `'platform.team_switch'` to auto-restart exclusion list                           |
| `convex/migration.ts`                                    | Add migration to convert persisted event reasons (see Step 5)                         |

### Step 4: Update CLI consumers

| File                                                                     | Change                                                                                         |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/machine/daemon-start/types.ts`                | Import `AgentStartReason`, `AgentStopReason` from backend entities instead of local definition |
| `packages/cli/src/infrastructure/machine/stop-reason.ts`                 | Align `StopReason` type with import from entities                                              |
| `packages/cli/src/infrastructure/machine/intentional-stops.ts`           | Add `'platform.team_switch'` to intentional stops                                              |
| `packages/cli/src/events/daemon/agent/on-request-start-agent.ts`         | Update type import                                                                             |
| `packages/cli/src/events/daemon/agent/on-request-stop-agent.ts`          | Update type import                                                                             |
| `packages/cli/src/events/daemon/agent/on-agent-exited.ts`                | Update type import                                                                             |
| `packages/cli/src/events/lifecycle/on-agent-shutdown.ts`                 | Update type import                                                                             |
| `packages/cli/src/events/daemon/event-bus.ts`                            | Align local `stopReason` type with import                                                      |
| `packages/cli/src/commands/machine/daemon-start/handlers/start-agent.ts` | Update reason literals                                                                         |
| `packages/cli/src/commands/machine/daemon-start/handlers/stop-agent.ts`  | Update reason literals                                                                         |

### Step 5: Migration for persisted events

```
agent.requestStop events:
  'user-stop'         → 'user.stop'
  'dedup-stop'        → 'platform.dedup'
  'team-switch'       → 'platform.team_switch'

agent.requestStart events:
  'user-start'        → 'user.start'
  'user-restart'      → 'user.restart'
  'ensure-agent-retry'→ 'platform.ensure_agent'
```

### Step 6: Tests

- Verify all existing tests pass with new reason strings
- Add test: `onAgentExited` excludes `'platform.team_switch'` from auto-restart
- Add test: circuit breaker excludes `'platform.team_switch'`
- Update all test string literals (~15 test files)

### Estimated scope

~22 source files + ~15 test files modified, 1 migration added.

---

## Phase 3: Backend — Wire New Queries (Replace Frontend-Facing API)

**Status**: Done
**Goal**: Expose Phase 1 use cases as Convex queries/mutations, creating the new API surface.

### New Convex queries to add

| New Query                      | Use Case                    | Replaces                                      |
| ------------------------------ | --------------------------- | --------------------------------------------- |
| `machines.getAgentStatus`      | `getAgentStatusForChatroom` | `machines.getAgentPanel` (status portion)     |
| `machines.getAgentStartConfig` | `getAgentConfigForStart`    | `machines.getAgentPanel` (start form portion) |
| `machines.listAgentOverview`   | `listChatroomAgentOverview` | `machines.listRemoteAgentRunningStatus`       |

### Deprecation strategy

- Add new queries alongside existing ones
- Mark old queries with `@deprecated` JSDoc
- Both old and new queries coexist during Phase 4 frontend migration

---

## Phase 4: Frontend — Migrate Hooks and Components

**Status**: Done
**Goal**: Switch frontend from raw table record consumption to the new backend-computed views.

### Migration map

| Frontend File                                     | Current Backend API                         | New Backend API                       |
| ------------------------------------------------- | ------------------------------------------- | ------------------------------------- |
| `hooks/useAgentPanelData.ts`                      | `api.machines.getAgentPanel`                | `api.machines.getAgentStatus`         |
| `context/ChatroomListingContext.tsx`              | `api.machines.listRemoteAgentRunningStatus` | `api.machines.listAgentOverview`      |
| `components/AgentStartModal.tsx`                  | `useAgentPanelData` (machineConfigs)        | `api.machines.getAgentStartConfig`    |
| `components/AgentPanel/UnifiedAgentListModal.tsx` | `useAgentPanelData`                         | `api.machines.getAgentStatus`         |
| `hooks/useWorkspaces.ts`                          | `TeamAgentConfig` from `useAgentPanelData`  | `WorkspaceView` from `getAgentStatus` |
| `components/AgentPanel/InlineAgentCard.tsx`       | `TeamAgentConfig`                           | `AgentRoleView` from `getAgentStatus` |

### Components that stay unchanged (no use case yet)

- `AgentSettingsModal.tsx` → keeps `listMachines`, `sendCommand`, `getDaemonPongEvent`
- `AgentConfigTabs.tsx` → keeps `getMachineModelFilters`, `upsertMachineModelFilters`
- `useAgentStatuses.ts` → keeps `getLatestAgentEventsForChatroom`
- `AgentRestartChart.tsx` → keeps `getAgentRestartMetrics`
- `SetupChecklist.tsx` → keeps `listMachines`

### Key changes

- `useAgentPanelData` hook refactored to consume `AgentRoleView[]` instead of raw configs
- `ChatroomListingContext` simplified: `runningConfigs` (with machineId) → `runningRoles` (string[])
- `AgentStartModal` no longer derives defaults client-side — backend provides them

---

## Phase 5: Cleanup — Remove Dead Code

**Status**: Done
**Goal**: Remove deprecated queries and unused types after frontend migration is verified.

### Removals

- `machines.getAgentPanel` query (replaced by `getAgentStatus` + `getAgentStartConfig`)
- `machines.listRemoteAgentRunningStatus` query (replaced by `listAgentOverview`)
- Raw config type exports that are no longer consumed by frontend
- Old hook implementations if fully replaced

### Safety checks before removal

- Verify no frontend imports of deprecated queries
- Verify no CLI imports of deprecated queries
- Run full test suite
- Run typecheck across all packages

---

## Execution Order

```
Phase 1   ✅ Done (PR #55) — Backend use cases + updateTeam refactor
Phase 2   ✅ Done          — Unify start/stop reason types
Phase 3   ✅ Done          — Wire new Convex queries
Phase 4   ✅ Done          — Frontend migration
Phase 5   ✅ Done          — Dead code cleanup
```

---

## Design Principles

1. **Single writer**: `machineAgentConfigs` are owned by the machine daemon — never delete/modify from platform side
2. **Event-driven cleanup**: Dispatch `agent.requestStop` events rather than direct DB manipulation
3. **Backend-computed views**: Frontend receives pre-computed `AgentRoleView[]`, never raw table records
4. **Single source of truth**: Domain entity types in `domain/entities/` are canonical — schema and CLI import from there
5. **Actor-prefixed dot notation**: All reason strings use `actor.action` format (e.g., `user.stop`, `platform.team_switch`)
