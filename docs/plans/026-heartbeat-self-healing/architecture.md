# Plan 026: Architecture — Heartbeat Self-Healing + Agent Status FSM

## Changes Overview

This revision extends Plan 026 beyond heartbeat self-healing to introduce a formal **Agent Status FSM** that replaces the current ad-hoc status derivation. The FSM is the single source of truth for agent status, stored in the backend and driven by daemon lifecycle events and heartbeat signals.

### Motivation

The current agent status is **derived** at query time from participant records and expiration checks. This creates discrepancies:

1. **No "restarting" state** — When the daemon is restarting an agent, the UI shows either "WORKING" (stale) or "NOT JOINED" (participant deleted), neither of which is accurate.
2. **No "dead" state** — When all restart attempts fail, the agent appears as "DISCONNECTED" or "NOT JOINED" with no indication that recovery was attempted and failed.
3. **No backend notification on restart failure** — The daemon's crash recovery exhausts retries locally but never reports the failure to the backend, so the UI can't distinguish "offline temporarily" from "permanently failed."
4. **Status is computed, not stored** — The frontend derives status from `participant.status` + `readyUntil` expiration, which means the backend has no authoritative status field to query or transition.

---

## Agent Status FSM

### States

```
┌─────────────────────────────────────────────────────┐
│                   DEAD STATES                       │
│              (no active heartbeat)                  │
│                                                     │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ offline  │  │  dead    │  │ dead_failed_revive│ │
│  │ (initial)│  │          │  │                   │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
└─────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│                  ALIVE STATES                       │
│              (heartbeat is active)                  │
│                                                     │
│  ┌──────────┐  ┌────────────┐  ┌──────────┐       │
│  │  ready   │  │ restarting │  │ working  │       │
│  └──────────┘  └────────────┘  └──────────┘       │
└─────────────────────────────────────────────────────┘
```

| State | Description | Heartbeat? | Entry Condition |
|-------|-------------|------------|-----------------|
| `offline` | Default initial state. Agent has never joined or was explicitly stopped. | No | Initial state / `participants.leave` called |
| `dead` | Heartbeat stopped. Agent process is presumed crashed. | No | Heartbeat TTL expired (cleanup cron) |
| `dead_failed_revive` | All restart attempts exhausted. Manual intervention required. | No | Daemon reports max retries exceeded |
| `ready` | Agent is running `wait-for-task`, heartbeat active, waiting for work. | Yes | `participants.join` / heartbeat resumes |
| `restarting` | Daemon is attempting to restart the agent after a crash. | No | Daemon begins crash recovery |
| `working` | Agent is actively processing a task, heartbeat active. | Yes | `participants.updateStatus(active)` |

### Transitions

```
                    ┌─────────┐
                    │ offline │ ◄──────────────────────────────────┐
                    └────┬────┘                                    │
                         │                                         │
                    join()                                    leave()
                         │                                         │
                         ▼                                         │
                    ┌─────────┐  task claimed   ┌─────────┐       │
              ┌────▶│  ready  │ ───────────────▶│ working │───────┘
              │     └────┬────┘                 └────┬────┘  (handoff/
              │          │                           │        complete)
              │          │                           │
              │     heartbeat                   heartbeat
              │     TTL expires                 TTL expires
              │          │                           │
              │          ▼                           ▼
              │     ┌─────────┐                ┌─────────┐
              │     │  dead   │                │  dead   │
              │     └────┬────┘                └────┬────┘
              │          │                           │
              │     daemon starts              daemon starts
              │     crash recovery             crash recovery
              │          │                           │
              │          ▼                           ▼
              │     ┌────────────┐             ┌────────────┐
              │     │ restarting │             │ restarting │
              │     └────┬───┬──┘             └────┬───┬──┘
              │          │   │                      │   │
              │    restart   all retries      restart   all retries
              │    succeeds  exhausted        succeeds  exhausted
              │          │   │                      │   │
              │          ▼   ▼                      ▼   ▼
              │          │   ┌───────────────────┐  │
              └──────────┘   │ dead_failed_revive│  │
                             └───────────────────┘  │
                                                    │
                                              (back to ready
                                               via join())
```

### Formal Transition Table

| From | To | Trigger | Actor |
|------|----|---------|-------|
| `offline` | `ready` | `join` | CLI (`wait-for-task`) |
| `ready` | `working` | `claim_task` | CLI (`task-started`) |
| `ready` | `dead` | `heartbeat_expired` | Backend (cleanup cron) |
| `ready` | `offline` | `leave` | CLI (graceful stop) / Daemon (crash recovery step 2) |
| `working` | `ready` | `task_complete` | CLI (`handoff` / `task-complete`) |
| `working` | `dead` | `heartbeat_expired` | Backend (cleanup cron) |
| `working` | `offline` | `leave` | CLI (graceful stop) |
| `dead` | `restarting` | `restart_initiated` | Daemon (crash recovery step 3) |
| `dead` | `ready` | `join` | CLI (manual restart / self-healing re-join) |
| `dead` | `offline` | `cleanup` | Backend (cleanup cron deletes participant) |
| `restarting` | `ready` | `join` | CLI (restarted agent calls `wait-for-task`) |
| `restarting` | `dead_failed_revive` | `restart_exhausted` | Daemon (all attempts failed) |
| `dead_failed_revive` | `ready` | `join` | CLI (manual restart from UI or CLI) |
| `dead_failed_revive` | `offline` | `cleanup` | Backend (cleanup cron deletes participant) |

---

## Implementation Strategy

### Backend: New `agentStatus` Field on `chatroom_participants`

Add a new field `agentStatus` to the `chatroom_participants` table that stores the FSM state explicitly.

```typescript
// Schema addition to chatroom_participants
agentStatus: v.optional(v.union(
  v.literal('offline'),
  v.literal('dead'),
  v.literal('dead_failed_revive'),
  v.literal('ready'),
  v.literal('restarting'),
  v.literal('working'),
)),
```

**Why a new field instead of replacing `status`?**

The existing `status` field (`'active' | 'waiting'`) is used by the task FSM, queue promotion, and cleanup logic. Replacing it would require updating all consumers simultaneously. Instead, `agentStatus` is a parallel field that the UI reads directly, while the existing `status` field continues to drive backend logic. Over time, `agentStatus` can subsume `status`.

### Backend: New Mutation `participants.updateAgentStatus`

```typescript
export const updateAgentStatus = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    role: v.string(),
    agentStatus: v.union(
      v.literal('offline'),
      v.literal('dead'),
      v.literal('dead_failed_revive'),
      v.literal('ready'),
      v.literal('restarting'),
      v.literal('working'),
    ),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    
    const participant = await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('role', args.role)
      )
      .unique();

    if (!participant) {
      // If participant doesn't exist and we're setting a dead state,
      // create a minimal participant record to hold the status
      if (['dead', 'dead_failed_revive', 'restarting'].includes(args.agentStatus)) {
        await ctx.db.insert('chatroom_participants', {
          chatroomId: args.chatroomId,
          role: args.role,
          status: 'waiting', // placeholder for legacy field
          agentStatus: args.agentStatus,
        });
        return;
      }
      throw new Error(`Participant ${args.role} not found in chatroom`);
    }

    await ctx.db.patch('chatroom_participants', participant._id, {
      agentStatus: args.agentStatus,
    });
  },
});
```

### Daemon: Report Status at Each Crash Recovery Step

Update `handleAgentCrashRecovery` in `daemon-start.ts`:

```typescript
async function handleAgentCrashRecovery(ctx, originalCommand, _crashedPid) {
  const { chatroomId, role } = originalCommand.payload;

  // Step 1: Clear PID (existing)
  await clearAgentPidEverywhere(ctx, chatroomId, role);

  // Step 2: Mark agent as offline (existing participants.leave)
  await ctx.client.mutation(api.participants.leave, { ... });

  // Step 3: Set status to "restarting" before attempting restarts
  await ctx.client.mutation(api.participants.updateAgentStatus, {
    sessionId: ctx.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    agentStatus: 'restarting',
  });

  // Step 4: Retry loop (existing)
  for (let attempt = 1; attempt <= MAX_CRASH_RESTART_ATTEMPTS; attempt++) {
    // ... existing retry logic ...
    // On success: agent calls join() → sets agentStatus to 'ready'
  }

  // Step 5: All attempts exhausted — report failure to backend
  await ctx.client.mutation(api.participants.updateAgentStatus, {
    sessionId: ctx.sessionId,
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    role,
    agentStatus: 'dead_failed_revive',
  });
}
```

### Daemon/CLI: Set `agentStatus` at Lifecycle Points

| Lifecycle Event | Where | `agentStatus` Set To |
|----------------|-------|---------------------|
| `wait-for-task` starts (join) | CLI | `ready` |
| Task claimed (`task-started`) | CLI | `working` |
| Task completed (`handoff`/`task-complete`) | CLI | `ready` |
| Agent gracefully stops | CLI | `offline` |
| Heartbeat TTL expires | Backend (cleanup cron) | `dead` |
| Daemon starts crash recovery | Daemon | `restarting` |
| Crash recovery succeeds | CLI (via join) | `ready` |
| All restart attempts fail | Daemon | `dead_failed_revive` |
| Manual restart from UI | Daemon (via command) | `restarting` → `ready` |

### Frontend: Read `agentStatus` Directly

Update `getTeamReadiness` to include `agentStatus` in the participant info:

```typescript
const participantInfo = participants.map((p) => ({
  role: p.role,
  status: p.status,
  agentStatus: p.agentStatus ?? deriveAgentStatus(p), // backward compat
  readyUntil: p.readyUntil,
  isExpired: p.readyUntil ? p.readyUntil < now : false,
}));
```

Where `deriveAgentStatus` provides backward compatibility for participants that don't yet have the field:

```typescript
function deriveAgentStatus(p: Participant): AgentStatus {
  if (p.isExpired) return 'dead';
  if (p.status === 'active') return 'working';
  if (p.status === 'waiting') return 'ready';
  return 'offline';
}
```

Update `AgentStatus` type and `STATUS_CONFIG` in the frontend:

```typescript
export type AgentStatus = 
  | 'offline'
  | 'dead'
  | 'dead_failed_revive'
  | 'ready'
  | 'restarting'
  | 'working';

const STATUS_CONFIG: Record<AgentStatus, { bg: string; text: string; label: string }> = {
  offline:             { bg: 'bg-chatroom-text-muted',    text: 'text-chatroom-status-warning', label: 'OFFLINE' },
  dead:                { bg: 'bg-chatroom-status-error',  text: 'text-chatroom-status-error',   label: 'DEAD' },
  dead_failed_revive:  { bg: 'bg-chatroom-status-error',  text: 'text-chatroom-status-error',   label: 'DEAD (UNRECOVERABLE)' },
  ready:               { bg: 'bg-chatroom-status-success', text: 'text-chatroom-status-success', label: 'READY' },
  restarting:          { bg: 'bg-chatroom-status-warning', text: 'text-chatroom-status-warning', label: 'RESTARTING' },
  working:             { bg: 'bg-chatroom-status-info',   text: 'text-chatroom-status-info',    label: 'WORKING' },
};
```

---

## Self-Healing Invariant (Preserved from Original Plan 026)

> **If an agent or daemon resumes normal heartbeat communication, the system MUST return to a fully healthy state within one heartbeat cycle (≤30s), regardless of what cleanup actions occurred during the outage.**

This invariant is preserved. The FSM adds precision:
- Daemon heartbeat recovery: sets `daemonConnected: true` (unchanged)
- Participant heartbeat re-join: returns `{ status: 'rejoin_required' }` → CLI calls `join()` → `agentStatus` transitions to `ready`
- From `dead` or `dead_failed_revive`: a successful `join()` transitions to `ready`

---

## Sequence Diagrams

### Agent Crash → Restart → Recovery

```
CLI/Agent       Daemon              Backend              Frontend
    │               │                    │                    │
    │──heartbeat───▶│                    │ agentStatus=ready  │──"READY"
    │               │                    │                    │
    ✗ (crash)       │                    │                    │
                    │                    │                    │
    (onExit fires)  │                    │                    │
                    │──leave()──────────▶│ participant deleted │
                    │                    │                    │──"NOT JOINED"
                    │──updateAgentStatus▶│ agentStatus=       │
                    │  (restarting)      │  restarting        │──"RESTARTING"
                    │                    │                    │
                    │──spawn agent       │                    │
                    │               ┌────│                    │
                    │               │    │                    │
                    │  new agent ───┘    │                    │
                    │               │    │                    │
                    │               │──join()────────────────▶│
                    │               │    │ agentStatus=ready  │──"READY"
                    │               │    │                    │
```

### Agent Crash → All Restarts Fail

```
CLI/Agent       Daemon              Backend              Frontend
    │               │                    │                    │
    ✗ (crash)       │                    │                    │
                    │                    │                    │
    (onExit fires)  │                    │                    │
                    │──leave()──────────▶│ participant deleted │
                    │──updateAgentStatus▶│ agentStatus=       │
                    │  (restarting)      │  restarting        │──"RESTARTING"
                    │                    │                    │
                    │──attempt 1 (fail)  │                    │
                    │──attempt 2 (fail)  │                    │
                    │──attempt 3 (fail)  │                    │
                    │                    │                    │
                    │──updateAgentStatus▶│ agentStatus=       │
                    │  (dead_failed_     │  dead_failed_revive│──"DEAD
                    │   revive)          │                    │   (UNRECOVERABLE)"
                    │                    │                    │
    (manual restart from UI)             │                    │
                    │◀─start-agent cmd───│                    │
                    │──spawn agent       │                    │
                    │               │──join()────────────────▶│
                    │               │    │ agentStatus=ready  │──"READY"
```

---

## Migration Strategy

### Backward Compatibility

- `agentStatus` is an **optional** field. Existing participants without it use `deriveAgentStatus()` for backward compatibility.
- The existing `status` field (`'active' | 'waiting'`) continues to work for all backend logic (task FSM, queue promotion, cleanup).
- Frontend reads `agentStatus` when available, falls back to derived status.
- No breaking changes to CLI commands or backend mutations.

### Cleanup Cron Update

`cleanupStaleAgents` should set `agentStatus: 'dead'` when it detects an expired participant (before deleting the record or as part of the expiration marking).

---

## Updated Provable Invariants

Extending the 7 invariants from the original Plan 026:

8. **Agent status FSM invariant:** The `agentStatus` field on a participant record always reflects one of the 6 defined FSM states, and transitions only occur via the defined transition table.
9. **Status consistency invariant:** If `agentStatus` is `ready` or `working`, then `readyUntil > now` (heartbeat is active). If `agentStatus` is `dead`, `dead_failed_revive`, or `offline`, then either no participant record exists or `readyUntil < now`.
10. **Restart visibility invariant:** When the daemon initiates crash recovery, the UI reflects "RESTARTING" within one mutation round-trip (~1-2s). When recovery fails, the UI reflects "DEAD (UNRECOVERABLE)" within one mutation round-trip.
