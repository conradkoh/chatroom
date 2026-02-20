# 028 — Agent Lifecycle Rework

## Overview

Replace the current split-state agent management system with a single `chatroom_machineAgentLifecycle` table that serves as the authoritative source of truth for agent status.

**Philosophy:** "Let it die" — no auto-restart. Backend cron only cleans up stale records. Agents restart on next user message or explicit Start button click.

### Current System (Problems)

1. **Split brain:** Daemon holds local PID state, backend holds participant + desired state. Neither can fully reconcile without the other.
2. **Fire-and-forget cleanup:** Critical mutations (`participants.leave`, `updateSpawnedAgent`) use `.catch()` with no retries.
3. **No convergent behavior:** If a participant record leaks (e.g., daemon crash), nothing actively cleans it up. TTL expiry only changes status to `dead`, never deletes.
4. **Double-cleanup race:** Both `onAgentShutdown` and `agent:exited` run the same mutations concurrently.
5. **State recovery doesn't clean participants:** Stale PIDs are cleared but participant records linger.
6. **Computed display status:** `get-agent-status.ts` reads from 3 tables to compute a display status, creating complexity.

### New System (Goals)

- One table (`chatroom_machineAgentLifecycle`), one state machine
- Display status = stored state (no computation)
- Backend cron handles stuck/stale record cleanup
- Daemon becomes a stateless executor
- Retry-with-backoff for critical mutations
- Convergent cleanup for duplicate records

---

## State Machine

```
offline → start_requested → starting → ready ↔ working
                                         ↓            ↓
                                   stop_requested → stopping → offline
                                         ↓            ↓
                                        dead ────────→ offline (cron cleanup)
```

### Valid Transitions

```typescript
const VALID_TRANSITIONS: Record<State, State[]> = {
  offline:         ['start_requested'],
  start_requested: ['starting', 'offline'],       // offline = timeout cleanup
  starting:        ['ready', 'offline'],           // offline = timeout cleanup
  ready:           ['working', 'stop_requested', 'dead'],
  working:         ['ready', 'stop_requested', 'dead'],
  stop_requested:  ['stopping', 'offline'],        // offline = timeout cleanup
  stopping:        ['offline'],
  dead:            ['offline'],                    // cron cleanup only
};
```

### States

| State | Meaning | Who Sets It |
|-------|---------|-------------|
| `offline` | Agent is not running | Cron, daemon (after kill), or initial state |
| `start_requested` | User clicked Start, command pending | `sendCommand(start-agent)` |
| `starting` | Daemon acked command, process spawning | Daemon (start-agent handler) |
| `ready` | Agent process alive, waiting for tasks | `wait-for-task` (participants.join equivalent) |
| `working` | Agent is actively processing a task | Task assignment / markActive equivalent |
| `stop_requested` | User clicked Stop, command pending | `sendCommand(stop-agent)` |
| `stopping` | Daemon acked stop, killing process | Daemon (stop-agent handler) |
| `dead` | Heartbeat expired, process presumed crashed | Backend cron |

---

## Schema

**Table:** `chatroom_machineAgentLifecycle`

```typescript
chatroom_machineAgentLifecycle: defineTable({
  chatroomId: v.id('chatroom_rooms'),
  teamId: v.string(),
  role: v.string(),
  state: v.union(
    v.literal('offline'),
    v.literal('start_requested'),
    v.literal('starting'),
    v.literal('ready'),
    v.literal('working'),
    v.literal('stop_requested'),
    v.literal('stopping'),
    v.literal('dead')
  ),
  machineId: v.optional(v.string()),
  pid: v.optional(v.number()),
  heartbeatAt: v.optional(v.number()),
  stateChangedAt: v.number(),
  model: v.optional(v.string()),
  agentHarness: v.optional(v.literal('opencode')),
  workingDir: v.optional(v.string()),
  connectionId: v.optional(v.string()),
})
  .index('by_chatroom_team_role', ['chatroomId', 'teamId', 'role'])
  .index('by_state', ['state'])
  .index('by_machine_state', ['machineId', 'state'])
```

**Uniqueness:** `(chatroomId, teamId, role)` — one lifecycle row per agent slot.

---

## Implementation Phases

### Phase 1: Add Table + Mutations (Backend Only) ← START HERE

New table and mutations exist alongside old system. Nothing reads from them yet.

#### Step 1.1: Schema
- **File:** `services/backend/convex/schema.ts`
- Add `chatroom_machineAgentLifecycle` table definition (see Schema section above)

#### Step 1.2: Transition Mutations
- **New file:** `services/backend/convex/machineAgentLifecycle.ts`
  - `transition(chatroomId, teamId, role, targetState, metadata?)` — validates legal transitions
  - `heartbeat(chatroomId, teamId, role)` — updates `heartbeatAt`
  - `requestStart(chatroomId, teamId, role, machineId, model, harness, workingDir)` — `offline → start_requested`
  - `requestStop(chatroomId, teamId, role)` — `ready/working → stop_requested`
  - `getStatus(chatroomId, teamId, role)` — returns current state
  - `getTeamStatus(chatroomId)` — returns all lifecycle rows for a chatroom
  - `getByMachine(machineId)` — returns all agents assigned to a machine

- **New file:** `services/backend/src/domain/usecase/agent/machine-agent-lifecycle-transitions.ts`
  - `VALID_TRANSITIONS` map
  - `validateTransition(currentState, targetState)` function
  - Helper to resolve `teamId` from `chatroomId`

#### Step 1.3: Reconciliation Cron
- **File:** `services/backend/convex/crons.ts` — add cron entry
- **New file:** `services/backend/convex/machineAgentLifecycleReconcile.ts`
  - Internal mutation, runs every 60 seconds:
    - `ready/working` with `heartbeatAt + TTL < now` → `dead`
    - `dead` for > 60s → `offline`
    - `stopping` for > 60s → `offline`
    - `starting` for > 120s → `offline`
    - `stop_requested` for > 30s → `offline`

#### Step 1.4: Tests
- **New file:** `services/backend/tests/integration/machine-agent-lifecycle.spec.ts`
  - Test all valid transitions
  - Test invalid transitions are rejected
  - Test cron cleanup behavior
  - Test heartbeat expiry

**Verification:** `pnpm test` in `services/backend`. Old system unaffected.

---

### Phase 2: Dual-Write from Backend Mutations

Every mutation that writes to `chatroom_participants` or `chatroom_machineAgentDesiredState` ALSO writes to `chatroom_machineAgentLifecycle`.

#### Step 2.1: Instrument `sendCommand` (start/stop)
- **File:** `services/backend/convex/machines.ts`
- `type: 'start-agent'` → also call `lifecycle.requestStart()`
- `type: 'stop-agent'` → also call `lifecycle.requestStop()`

#### Step 2.2: Instrument `participants.join`
- **File:** `services/backend/convex/participants.ts`
- After join → also call `lifecycle.transition(→ ready)`

#### Step 2.3: Instrument `participants.leave`
- **File:** `services/backend/convex/participants.ts`
- After leave → also call `lifecycle.transition(→ offline)`

#### Step 2.4: Instrument heartbeat mutations
- **File:** `services/backend/convex/participants.ts`
- `extendActiveAgent` → also call `lifecycle.heartbeat()`

#### Step 2.5: Instrument status transitions
- When participant transitions to `active` → `lifecycle.transition(ready → working)`
- When participant transitions to `waiting` → `lifecycle.transition(working → ready)`

#### Step 2.6: Instrument cleanup/death
- **File:** `services/backend/convex/tasks.ts`
- `cleanupStaleAgents` → also call `lifecycle.transition(→ dead)`

**Verification:** `pnpm test`. Both tables stay in sync.

---

### Phase 3: Migrate Frontend

Frontend reads from `chatroom_machineAgentLifecycle` instead of computed `get-agent-status.ts`.

#### Step 3.1: New queries
- **File:** `services/backend/convex/machineAgentLifecycle.ts`
- `getTeamLifecycle(chatroomId)` — returns lifecycle states for all roles

#### Step 3.2: Update types
- **File:** `apps/webapp/src/modules/chatroom/types/readiness.ts`
- Map lifecycle states to display labels:
  - `start_requested` → "Starting"
  - `stop_requested` → "Stopping"
  - Others map directly

#### Step 3.3: Migrate components
- `AgentPanel.tsx` — use new query
- `AgentConfigTabs.tsx` — status badge
- `ChatroomSelector.tsx` — status indicators
- `SetupChecklist.tsx` — status banner
- `TeamStatus.tsx` — team readiness
- `ChatroomDashboard.tsx` — readiness display
- `ChatroomListingContext.tsx` — chatroom list status

#### Step 3.4: Remove auto-restart
- **Delete:** `hooks/useAutoRestartAgents.ts`
- Remove usage from parent components

**Verification:** Manual test in browser, both light and dark mode.

---

### Phase 4: Migrate Daemon

Daemon calls lifecycle mutations instead of `participants.join/leave/extendActiveAgent`.

#### Step 4.1: start-agent handler
- After spawn → `lifecycle.transition(start_requested → starting, { pid, machineId })`

#### Step 4.2: stop-agent handler
- After kill → `lifecycle.transition(→ offline)`

#### Step 4.3: Event listeners
- `agent:exited` → `lifecycle.transition(→ offline)` or `(→ dead)` based on `intentional`

#### Step 4.4: on-agent-shutdown
- After kill → `lifecycle.transition(stopping → offline)`

#### Step 4.5: Command loop heartbeat
- Replace `participants.extendActiveAgent` with `lifecycle.heartbeat()`

#### Step 4.6: wait-for-task session
- `participants.join` → `lifecycle.transition(→ ready)`
- `participants.leave` → `lifecycle.transition(→ offline)`

#### Step 4.7: State recovery
- Query `lifecycle.getByMachine(machineId)` for agents on this machine
- Dead PIDs → `lifecycle.transition(→ dead)`

#### Step 4.8: Retry queue
- **New file:** `packages/cli/src/infrastructure/retry-queue.ts`
- Wrap lifecycle calls with retry-with-backoff (3 retries, exponential)

**Verification:** `pnpm test` for CLI. Manual E2E.

---

### Phase 5: Remove Old System

#### Step 5.1: Remove old backend code
- **Delete:** `get-agent-status.ts`, `upsert-desired-state.ts`, `restart-offline-agent.ts`
- **Delete:** `machineAgentDesiredState.ts`
- **Simplify:** `participants.ts` — remove lifecycle mutations
- **Update:** `machines.ts` — remove `upsertDesiredState`, `updateSpawnedAgent`
- **Update:** `chatrooms.ts` — `getTeamReadiness` reads from lifecycle table
- **Update:** `tasks.ts` — `cleanupStaleAgents` uses lifecycle table

#### Step 5.2: Remove old daemon code
- Remove `participants.*` API calls
- Remove `machines.updateSpawnedAgent` calls
- Remove `clearAgentPidEverywhere`

#### Step 5.3: Schema cleanup
- Remove `chatroom_machineAgentDesiredState` table
- Remove PID fields from `chatroom_machineAgentConfigs`
- Simplify `chatroom_participants` status union

#### Step 5.4: Update tests
- Migrate integration tests to lifecycle mutations
- Remove old test helpers

**Verification:** Full `pnpm test`, `pnpm typecheck`, manual E2E.

---

## Risk Mitigation

1. **Feature flag:** `USE_AGENT_LIFECYCLE` in `services/backend/config/featureFlags.ts`. Dual-write behind flag during Phase 2-4.
2. **Rollback:** Both systems write in parallel → revert to reading old tables anytime.
3. **Data migration:** One-time script to populate lifecycle from existing tables before Phase 5.
4. **Incremental commits:** Each step = separate commit with passing tests.

---

## Files Impacted

### Backend (services/backend/)
| File | Phase | Action |
|------|-------|--------|
| `convex/schema.ts` | 1, 5 | Add table (P1), remove old tables (P5) |
| `convex/machineAgentLifecycle.ts` | 1, 3 | **NEW** — mutations + queries |
| `convex/machineAgentLifecycleReconcile.ts` | 1 | **NEW** — cron handler |
| `convex/crons.ts` | 1 | Add cron entry |
| `src/domain/usecase/agent/machine-agent-lifecycle-transitions.ts` | 1 | **NEW** — transition logic |
| `convex/participants.ts` | 2, 5 | Dual-write (P2), simplify (P5) |
| `convex/machines.ts` | 2, 5 | Dual-write (P2), cleanup (P5) |
| `convex/messages.ts` | 2 | Dual-write |
| `convex/tasks.ts` | 2, 5 | Dual-write (P2), migrate (P5) |
| `convex/chatrooms.ts` | 3, 5 | Migrate queries |
| `convex/machineAgentDesiredState.ts` | 5 | **DELETE** |
| `src/domain/usecase/agent/get-agent-status.ts` | 5 | **DELETE** |
| `src/domain/usecase/agent/upsert-desired-state.ts` | 5 | **DELETE** |
| `src/domain/usecase/agent/restart-offline-agent.ts` | 5 | **DELETE** |
| `config/featureFlags.ts` | 1 | Add flag |

### Daemon (packages/cli/)
| File | Phase | Action |
|------|-------|--------|
| `commands/machine/daemon-start/handlers/start-agent.ts` | 4 | Migrate to lifecycle |
| `commands/machine/daemon-start/handlers/stop-agent.ts` | 4 | Migrate to lifecycle |
| `commands/machine/daemon-start/event-listeners.ts` | 4 | Migrate to lifecycle |
| `commands/machine/daemon-start/command-loop.ts` | 4 | Migrate heartbeat |
| `commands/machine/daemon-start/handlers/state-recovery.ts` | 4 | Use lifecycle queries |
| `commands/machine/events/on-agent-shutdown/index.ts` | 4 | Migrate to lifecycle |
| `commands/wait-for-task/index.ts` | 4 | Migrate join |
| `commands/wait-for-task/session.ts` | 4 | Migrate join/leave |
| `infrastructure/retry-queue.ts` | 4 | **NEW** |
| `commands/machine/daemon-start/handlers/shared.ts` | 5 | Remove `clearAgentPidEverywhere` |

### Frontend (apps/webapp/)
| File | Phase | Action |
|------|-------|--------|
| `modules/chatroom/types/readiness.ts` | 3 | Update types |
| `modules/chatroom/components/AgentPanel.tsx` | 3 | Use new query |
| `modules/chatroom/components/AgentConfigTabs.tsx` | 3 | Update status badge |
| `modules/chatroom/components/ChatroomSelector.tsx` | 3 | Update indicators |
| `modules/chatroom/components/SetupChecklist.tsx` | 3 | Update banner |
| `modules/chatroom/components/TeamStatus.tsx` | 3 | Update readiness |
| `modules/chatroom/ChatroomDashboard.tsx` | 3 | Update readiness |
| `modules/chatroom/context/ChatroomListingContext.tsx` | 3 | Update listing |
| `modules/chatroom/hooks/useAutoRestartAgents.ts` | 3 | **DELETE** |

---

## Progress Tracker

- [x] **Phase 1:** Table + Mutations + Cron + Tests
  - [x] Step 1.1: Schema
  - [x] Step 1.2: Transition mutations
  - [x] Step 1.3: Reconciliation cron
  - [x] Step 1.4: Tests (25 tests passing)
- [x] **Phase 2:** Dual-Write
  - [x] Step 2.0: lifecycle-helpers.ts (tryLifecycleTransition, tryLifecycleHeartbeat)
  - [x] Step 2.1: sendCommand (machines.ts — start-agent, stop-agent)
  - [x] Step 2.2: participants.join → lifecycle ready
  - [x] Step 2.3: participants.leave → lifecycle offline
  - [x] Step 2.4: heartbeat (participants.heartbeat + extendActiveAgent)
  - [x] Step 2.5: status transitions (updateStatus: active→working, waiting→ready)
  - [x] Step 2.6: cleanupStaleAgents (stale→dead, deadline→offline, FSM→offline)
- [x] **Phase 3:** Frontend Migration
  - [x] Step 3.1: New query (getTeamLifecycle in machineAgentLifecycle.ts)
  - [x] Step 3.2: Types unchanged — existing display statuses cover all lifecycle states
  - [x] Step 3.3: ChatroomDashboard migrated to api.machineAgentLifecycle.getTeamLifecycle
  - [x] Step 3.4: Removed useAutoRestartAgents hook + restarting banner
- [ ] **Phase 4:** Daemon Migration
  - [ ] Step 4.1: start-agent
  - [ ] Step 4.2: stop-agent
  - [ ] Step 4.3: event listeners
  - [ ] Step 4.4: on-agent-shutdown
  - [ ] Step 4.5: heartbeat
  - [ ] Step 4.6: wait-for-task
  - [ ] Step 4.7: state recovery
  - [ ] Step 4.8: retry queue
- [ ] **Phase 5:** Remove Old System
  - [ ] Step 5.1: Remove old backend
  - [ ] Step 5.2: Remove old daemon code
  - [ ] Step 5.3: Schema cleanup
  - [ ] Step 5.4: Update tests

---

## Resume Command

To rejoin the chatroom and continue working on this plan:

```bash
CHATROOM_CONVEX_URL=http://127.0.0.1:3210 chatroom wait-for-task --chatroom-id=jx750h696te75x67z5q6cbwkph7zvm2x --role=planner
```
