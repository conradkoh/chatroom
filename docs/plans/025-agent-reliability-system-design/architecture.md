# Plan 025: Architecture — Agent Reliability

## Changes Overview

Introduce a two-model liveness detection system that handles remote and custom agents differently, add heartbeat infrastructure, deduplicate auto-restart commands, and extend task recovery to cover `pending` and `acknowledged` states.

## First Principle

> **An agent is reachable if and only if it can receive and respond to tasks within a bounded time.**

This shifts from "prove you're alive" to "prove you can do work." Liveness ≠ reachability:
- A custom agent in Cursor is alive but not reachable between `wait-for-task` calls
- A remote agent with a daemon is reachable as long as the daemon can restart it

## Two-Model Liveness

| Agent Type | Reachability Signal | Detection Time | Recovery Mechanism |
|-----------|--------------------|----|---|
| **Remote** (daemon-managed) | Heartbeat from `wait-for-task` process | ~60s (heartbeat TTL) | Auto-restart via daemon |
| **Custom** (user-managed) | Task acknowledgement within timeout | ~5 min (configurable) | Notify user (cannot auto-restart) |

---

## Sequence Diagrams

### Happy Path: Remote Agent

```
User        Frontend       Backend        Daemon        CLI/Agent
 │              │              │              │              │
 │──message────▶│──send()─────▶│──createTask──▶              │
 │              │              │              │              │
 │              │              │  participant exists          │
 │              │              │  readyUntil > now ✓          │
 │              │              │  → agent is reachable        │
 │              │              │              │              │
 │              │              │──notify(task)────────────────▶│
 │              │              │◀─claimTask───────────────────│
 │              │              │◀─startTask───────────────────│
 │              │              │◀─handoff─────────────────────│
 │◀─response───│◀─────────────│              │              │
```

### Failure + Recovery: Remote Agent Crash

```
CLI/Agent       Backend              Daemon
    │               │                    │
    │──heartbeat───▶│ readyUntil=now+60s │
    │               │                    │
    ✗ (crash)       │                    │
                    │                    │
    (30s later)     │                    │
                    │ no heartbeat       │
    (60s later)     │                    │
                    │ readyUntil < now   │
                    │ → EXPIRED          │
                    │                    │
    (cleanup cron)  │                    │
                    │──removeParticipant │
                    │──recoverTasks      │
                    │                    │
    (new message)   │                    │
                    │ no participant     │
                    │ → auto-restart ────▶│
                    │                    │──spawn new agent
                    │◀───────────────────│
```

### Failure + Recovery: Custom Agent Disconnects

```
Custom Agent    Backend              User (webapp)
    │               │                    │
    │──wait-for-task▶│ participant joins  │
    │◀─task─────────│                    │
    │               │ participant leaves │
    │               │ (or heartbeat      │
    │               │  expires)          │
    │               │                    │
    │ (working...)  │                    │
    │               │                    │
    │ (agent dies   │                    │
    │  or forgets   │                    │
    │  to reconnect)│                    │
    │               │                    │
    (5 min later)   │                    │
                    │ task still pending  │
                    │ no participant      │
                    │ type=custom         │
                    │ → CANNOT auto-restart
                    │                    │
                    │──log warning        │
                    │  (notification      │
                    │   planned for       │
                    │   future release)   │
```

### Failure + Recovery: Duplicate Auto-Restart Prevention

```
Backend (msg1)     Backend (msg2)     Commands Table
    │                   │                   │
    │ isOffline? YES    │                   │
    │                   │ isOffline? YES    │
    │                   │                   │
    │ check pending     │                   │
    │ start-agent cmd   │                   │
    │ → none found      │                   │
    │                   │                   │
    │──insert stop+start────────────────────▶│
    │                   │                   │
    │                   │ check pending     │
    │                   │ start-agent cmd   │
    │                   │ → FOUND (from msg1)│
    │                   │ → SKIP            │
    │                   │                   │
    Result: only 1 restart pair
```

### Failure + Recovery: Stuck `acknowledged` Task

```
Backend              Cleanup Cron
    │                    │
    │ task: acknowledged  │
    │ assignedTo: agentX  │
    │                    │
    │ (agentX dies)      │
    │                    │
    │ (2 min later)      │
    │                    │──check acknowledged tasks
    │                    │  participant for agentX?
    │                    │  → expired or missing
    │                    │
    │                    │──transitionTask:
    │                    │  acknowledged → pending
    │                    │  (trigger: recoverStuck)
    │                    │
    │                    │──autoRestartIfRemote
    │                    │
    │ task: pending       │
    │ ready for new claim │
```

---

## New Components

### `participants.heartbeat` (Backend Mutation)

Refreshes a participant's `readyUntil` timestamp. Called periodically by the `wait-for-task` CLI.

```typescript
interface HeartbeatArgs {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  connectionId: string;
}
```

**Behavior:**
- Find participant by chatroomId + role
- Verify `connectionId` matches (reject stale processes)
- Update `readyUntil = Date.now() + HEARTBEAT_TTL_MS`

### Heartbeat Timer (CLI)

A `setInterval` inside `wait-for-task` that calls `participants.heartbeat` every `HEARTBEAT_INTERVAL_MS`.

### Process Exit Watcher (Daemon)

Uses the driver's `onExit` callback (registered via `DriverStartResult.onExit`) in the daemon's `handleStartAgent` to detect when a spawned agent process dies unexpectedly. On exit, the handler clears the PID in the backend and local state.

## Modified Components

### `wait-for-task` CLI Command

- **Add:** Set `readyUntil` on `participants.join` call
- **Add:** Start heartbeat interval after joining
- **Add:** Call `participants.leave` on all exit paths (task received, signal, error)
- **Add:** Clear heartbeat interval on exit

### `cleanupStaleAgents` (Backend Cron)

- **Extend:** After cleaning expired participants, also check for stuck tasks:
  - `pending` tasks with no reachable participant for the target role → trigger auto-restart (remote) or notify (custom)
  - `acknowledged` tasks with expired/missing participant → reset to `pending`

### `autoRestartOfflineAgent` (Backend)

- **Add:** Check for existing pending `start-agent` command for the same role before inserting
- **Add:** Skip if a pending restart already exists (deduplication)

### `handleStartAgent` (Daemon)

- **Add:** Register `onExit` callback from `DriverStartResult` to clear PID in backend on unexpected process death

### Task State Machine

- **Add:** `recoverStuckAcknowledged` trigger: `acknowledged` → `pending`
- **Note:** Stuck `pending` tasks remain in `pending` status (no FSM transition needed). Recovery actions (auto-restart for remote agents, log warning for custom agents) are triggered without changing the task state.

## New Contracts

```typescript
// Heartbeat configuration constants
interface HeartbeatConfig {
  /** How often the CLI sends a heartbeat (ms). Default: 30000 */
  HEARTBEAT_INTERVAL_MS: number;
  /** How long a participant is considered reachable after last heartbeat (ms). Default: 60000 */
  HEARTBEAT_TTL_MS: number;
  /** How long a task can be pending before triggering recovery (ms). Default: 300000 (5 min) */
  TASK_PENDING_TIMEOUT_MS: number;
  /** How long a task can be acknowledged before triggering recovery (ms). Default: 120000 (2 min) */
  TASK_ACKNOWLEDGED_TIMEOUT_MS: number;
}

// Participant heartbeat mutation args
interface ParticipantHeartbeatArgs {
  sessionId: string;
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  connectionId: string;
}

// Cleanup result
// Note: `cleanupStaleAgents` returns `void` and logs summary information
// to the console instead of returning a structured result. The counts below
// are tracked internally and emitted via `console.warn` for observability.
// Fields: expiredParticipants, stuckPendingTasks, stuckAcknowledgedTasks,
//         autoRestartsTriggered
```

## Modified Contracts

### `chatroom_participants` Schema

No schema change needed — `readyUntil` already exists as an optional field. The change is behavioral: `wait-for-task` will now always set it.

### Task FSM Transitions

Add new triggers:

```typescript
// New FSM transitions
{ from: 'acknowledged', to: 'pending', trigger: 'recoverStuckAcknowledged' }
{ from: 'in_progress', to: 'pending', trigger: 'recoverOrphaned' } // formalize existing behavior
```

## Data Flow Changes

### Current Flow (No Liveness Detection)

```
Agent joins → participant created (readyUntil: undefined) → never expires → ghost on death
```

### Proposed Flow (Heartbeat-Based)

```
Agent joins → participant created (readyUntil: now+60s)
  → heartbeat every 30s refreshes readyUntil
  → on death: heartbeat stops → readyUntil expires in ≤60s
  → cleanup cron removes participant → recovers tasks → triggers restart
```

### Proposed Flow (Task-Timeout for Custom)

```
Custom agent joins → participant created (readyUntil: now+60s)
  → wait-for-task exits → participant.leave() called → immediate cleanup
  → agent works (no participant) → task created for role
  → no participant → task pending timeout (5 min) → notify user
```

---

## Provable Invariants

1. **Heartbeat invariant:** If a `wait-for-task` process is running, `readyUntil > now` is always true (refreshed every 30s, TTL 60s).
2. **Cleanup invariant:** If `readyUntil < now`, the participant WILL be removed within 2 minutes (cleanup runs every 2 min).
3. **Task recovery invariant:** If a task is `pending` or `acknowledged` and no valid participant exists for the target role, the task WILL be recovered within `max(TASK_PENDING_TIMEOUT_MS, TASK_ACKNOWLEDGED_TIMEOUT_MS) + 2 min`.
4. **Dedup invariant:** At most one pending `start-agent` command exists per role per chatroom at any time.
5. **Exit invariant:** When `wait-for-task` exits (any reason), `participants.leave` is called, providing immediate cleanup.
6. **Type-aware recovery:** Remote agents trigger auto-restart; custom agents log a warning (user notification is planned for a future enhancement). The system never attempts to auto-restart a custom agent.
