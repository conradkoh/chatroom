# Plan 025: Agent Reliability System Design

## Problem Statement

Agents in the chatroom system can become unresponsive without the system detecting it. This leads to tasks stuck in `pending`/`acknowledged`, ghost participants that block auto-restart, and duplicate restart commands. The root cause is that **liveness is inferred from stale state rather than proven by continuous signals**.

## First Principle

> **An agent is alive if and only if it has recently proven it is alive.**

Everything else — PIDs, participant records, daemon flags — is secondary evidence that can become stale. The system must be designed around **continuous proof of liveness** (heartbeat), not **absence of proof of death** (timeout on stale records).

---

## Current Architecture (As-Is)

### Component Roles

| Component | Responsibility |
|-----------|---------------|
| **Frontend (webapp)** | Sends start/stop commands, displays agent status |
| **Backend (Convex)** | Stores state, routes messages, triggers auto-restart |
| **CLI (wait-for-task)** | Subscribes to tasks, joins as participant |
| **Daemon** | Spawns/kills agent processes, processes machine commands |
| **Agent Process** | Runs the AI agent (e.g., opencode) |

### Current Liveness Detection

```
Frontend ──sendCommand──▶ Backend ──machineCommand──▶ Daemon ──spawn──▶ Agent
                              │                                          │
                              │◀──── (no heartbeat) ────────────────────│
                              │                                          │
                         participants table                    wait-for-task CLI
                         (readyUntil: undefined)               (no keepalive)
```

**Problem:** After spawn, the backend has no continuous signal from the agent. It relies on:
- `readyUntil` / `activeUntil` timestamps (never set by wait-for-task)
- `daemonConnected` flag (only tells if daemon is up, not if agent is alive)
- `spawnedAgentPid` (stale if process dies without cleanup)

---

## Sequence Diagrams

### 1. Happy Path: User Message → Agent Processing

```
User        Frontend       Backend        Daemon        Agent/CLI
 │              │              │              │              │
 │──message────▶│              │              │              │
 │              │──send()─────▶│              │              │
 │              │              │──createTask──▶│              │
 │              │              │              │              │
 │              │              │  isAgentOnline?              │
 │              │              │  ✓ participant exists         │
 │              │              │  ✓ readyUntil not expired     │
 │              │              │              │              │
 │              │              │──notify──────────────────────▶│
 │              │              │              │              │
 │              │              │◀─claimTask───────────────────│
 │              │              │◀─startTask───────────────────│
 │              │              │◀─handoff─────────────────────│
 │              │              │              │              │
 │◀─response───│◀─────────────│              │              │
```

**No failure here.** Agent is connected, claims task, processes it.

### 2. Failure: Agent Dies, System Doesn't Know

```
User        Frontend       Backend        Daemon        Agent/CLI
 │              │              │              │              │
 │              │              │              │    Agent dies (crash/kill)
 │              │              │              │         ✗ (no exit handler)
 │              │              │              │              │
 │              │              │  participant still exists     │
 │              │              │  readyUntil: undefined        │
 │              │              │  → never expires              │
 │              │              │  spawnedAgentPid: stale       │
 │              │              │              │              │
 │──message────▶│              │              │              │
 │              │──send()─────▶│              │              │
 │              │              │──createTask──▶│              │
 │              │              │              │              │
 │              │              │  isAgentOnline?              │
 │              │              │  ✓ participant exists (STALE) │
 │              │              │  ✓ readyUntil: undefined      │
 │              │              │  → THINKS AGENT IS ONLINE     │
 │              │              │  → NO AUTO-RESTART            │
 │              │              │              │              │
 │              │              │  Task stays in `pending`      │
 │              │              │  forever...                   │
 │              │              │              │              │
```

**Root cause:** No heartbeat, no `readyUntil`, no exit cleanup.

### 3. Failure: Duplicate Auto-Restart

```
User        Frontend       Backend                    Daemon
 │              │              │                          │
 │──msg1───────▶│──send()─────▶│                          │
 │──msg2───────▶│──send()─────▶│                          │
 │              │              │                          │
 │              │              │  msg1: isAgentOnline? NO  │
 │              │              │  msg2: isAgentOnline? NO  │
 │              │              │  (concurrent, both see    │
 │              │              │   same offline state)     │
 │              │              │                          │
 │              │              │──stop+start (from msg1)──▶│
 │              │              │──stop+start (from msg2)──▶│
 │              │              │                          │
 │              │              │  Daemon processes:        │
 │              │              │  1. stop (nothing to stop)│
 │              │              │  2. start → Agent A       │
 │              │              │  3. stop → kills Agent A  │
 │              │              │  4. start → Agent B       │
 │              │              │                          │
 │              │              │  Result: Agent A's work   │
 │              │              │  is lost, Agent B starts  │
 │              │              │  fresh                    │
```

**Root cause:** No deduplication of restart commands.

### 4. Failure: Task Stuck in `acknowledged`

```
Backend                     Agent/CLI
 │                              │
 │──task pending───────────────▶│
 │◀─claimTask (acknowledged)───│
 │                              │
 │                    Agent dies before startTask
 │                              ✗
 │                              │
 │  Task status: acknowledged   │
 │  assignedTo: dead agent      │
 │                              │
 │  cleanupStaleAgents runs...  │
 │  → only recovers in_progress │
 │  → acknowledged is IGNORED   │
 │                              │
 │  Task stuck forever          │
```

**Root cause:** FSM recovery only handles `in_progress`, not `acknowledged`.

---

## Proposed Architecture (To-Be)

### Core Design: Heartbeat-Based Liveness

```
Agent/CLI ──heartbeat(every 30s)──▶ Backend
                                       │
                                       ├── Update participant.readyUntil = now + 60s
                                       ├── If expired → mark offline
                                       └── If offline + pending task → auto-restart
```

**Invariant:** `readyUntil` is always set and always refreshed. If it expires, the agent is dead.

### Component Changes

#### 1. CLI (`wait-for-task`)

```
┌─────────────────────────────────────┐
│ wait-for-task                       │
│                                     │
│  ┌──────────┐   ┌───────────────┐  │
│  │ Task Sub  │   │ Heartbeat     │  │
│  │ (ws)      │   │ Timer (30s)   │  │
│  └─────┬─────┘   └──────┬────────┘  │
│        │                │           │
│        │    participants.heartbeat() │
│        │                │           │
│  On task received:      On exit:    │
│  → process task         → leave()   │
│  → leave()                          │
│  → exit                             │
└─────────────────────────────────────┘
```

**Changes:**
- Add `setInterval` heartbeat that calls `participants.heartbeat` every 30s
- Set `readyUntil = now + 60s` on join and each heartbeat
- Call `participants.leave` on all exit paths (task received, signal, error)

#### 2. Backend (`participants`)

New mutation: `participants.heartbeat`
```typescript
export const heartbeat = mutation({
  args: { sessionId, chatroomId, role, connectionId },
  handler: async (ctx, args) => {
    const participant = await findParticipant(ctx, args);
    if (!participant) return;
    if (participant.connectionId !== args.connectionId) return; // stale process
    await ctx.db.patch(participant._id, {
      readyUntil: Date.now() + 60_000, // 60s TTL
    });
  },
});
```

#### 3. Backend (`cleanupStaleAgents`)

Enhanced to handle all stuck states:

```typescript
// Current: only cleans expired readyUntil/activeUntil
// Proposed: also handles stuck tasks

async function cleanupStaleAgents(ctx) {
  const now = Date.now();
  
  for (const participant of allParticipants) {
    // Existing: clean expired participants
    if (participant.readyUntil && now > participant.readyUntil) {
      await removeParticipant(ctx, participant);
      await recoverOrphanedTasks(ctx, participant);
    }
  }
  
  // NEW: Check for stuck tasks (no participant or expired participant)
  for (const task of pendingAndAcknowledgedTasks) {
    const targetRole = task.targetRole;
    const participant = await getParticipantForRole(ctx, targetRole);
    
    if (!participant || isExpired(participant)) {
      if (task.status === 'acknowledged') {
        // Reset to pending so it can be re-claimed
        await transitionTask(ctx, task, 'pending', 'recoverStuckAcknowledged');
      }
      // Trigger auto-restart for the role
      await autoRestartOfflineAgent(ctx, task.chatroomId, targetRole);
    }
  }
}
```

#### 4. Backend (`autoRestartOfflineAgent`)

Add deduplication:

```typescript
async function autoRestartOfflineAgent(ctx, chatroomId, targetRole) {
  // Check for existing pending start-agent command for this role
  const existingCmd = await ctx.db
    .query('chatroom_machineCommands')
    .withIndex('by_machine', ...)
    .filter(q => 
      q.eq(q.field('status'), 'pending') &&
      q.eq(q.field('type'), 'start-agent') &&
      q.eq(q.field('payload.role'), targetRole)
    )
    .first();
  
  if (existingCmd) {
    // Already a pending restart — skip
    return;
  }
  
  // Proceed with stop + start
  ...
}
```

#### 5. Daemon (process death monitoring)

```typescript
function handleStartAgent(command) {
  const child = spawn(...);
  
  // NEW: Watch for unexpected exit
  child.on('exit', async (code, signal) => {
    console.log(`Agent ${role} exited: code=${code} signal=${signal}`);
    
    // Clear PID in backend
    await clearSpawnedAgent(machineId, chatroomId, role);
    
    // Clear participant (agent is no longer connected)
    // The heartbeat will expire naturally, but this is faster
    await notifyAgentDeath(machineId, chatroomId, role);
  });
  
  return child.pid;
}
```

---

## State Machines

### Participant State Machine

```
                    join(readyUntil)
    ┌──────────┐ ──────────────────▶ ┌──────────┐
    │DISCONNECTED│                    │ WAITING  │◀──┐
    └──────────┘ ◀──────────────────  └──────────┘   │
                    leave() or                │       │ heartbeat()
                    readyUntil expired        │       │ (refresh readyUntil)
                                              │       │
                                    claimTask │       │
                                              ▼       │
                                         ┌──────────┐│
                                         │  ACTIVE  │┘
                                         └──────────┘
                                              │
                                    leave() or│
                                    activeUntil expired
                                              │
                                              ▼
                                         ┌──────────┐
                                         │DISCONNECTED│
                                         └──────────┘
```

**Transitions:**
| From | To | Trigger | Side Effects |
|------|-----|---------|-------------|
| DISCONNECTED | WAITING | `join()` | Set `readyUntil` |
| WAITING | WAITING | `heartbeat()` | Refresh `readyUntil` |
| WAITING | ACTIVE | `claimTask()` | Set `activeUntil` |
| ACTIVE | ACTIVE | `heartbeat()` | Refresh `activeUntil` |
| ACTIVE | DISCONNECTED | `leave()` or timeout | Recover orphaned tasks |
| WAITING | DISCONNECTED | `leave()` or timeout | Trigger auto-restart if pending tasks |

### Task State Machine (Extended)

```
                 ┌─────────┐
                 │ QUEUED   │
                 └────┬─────┘
                      │ promoteNextTask
                      ▼
                 ┌─────────┐  timeout (5 min)   ┌──────────────┐
                 │ PENDING  │──────────────────▶│ PENDING       │
                 └────┬─────┘  no participant   │ + auto-restart│
                      │                         └──────┬────────┘
                      │ claimTask                      │
                      ▼                                │
                 ┌─────────────┐  timeout (2 min)      │
                 │ ACKNOWLEDGED │──────────────────────▶│
                 └────┬────────┘  agent died            │
                      │                                │
                      │ startTask                      │
                      ▼                                │
                 ┌─────────────┐  agent disconnected   │
                 │ IN_PROGRESS  │──────────────────────▶│
                 └────┬────────┘  (existing recovery)  │
                      │                                │
                      │ completeTask                   │
                      ▼                                │
                 ┌─────────────┐                       │
                 │ COMPLETED    │                       │
                 └──────────────┘                       │
```

**New transitions:**
| From | To | Trigger | Timeout |
|------|-----|---------|---------|
| PENDING | PENDING + auto-restart | No participant for role | 5 min |
| ACKNOWLEDGED | PENDING + auto-restart | Agent disconnected | 2 min |

---

## Failure Cases and Solutions

### F1: Agent process crashes

| Step | Current | Proposed |
|------|---------|----------|
| Detection | Never (ghost participant) | Heartbeat expires in 60s |
| Recovery | Manual | Auto: participant removed, task reset, auto-restart triggered |
| Time to recover | ∞ | ~2 min (60s heartbeat expiry + 60s cleanup cycle) |

### F2: Daemon crashes

| Step | Current | Proposed |
|------|---------|----------|
| Detection | `daemonConnected` goes false on next check | Same, plus heartbeat expiry for all agents |
| Recovery | Daemon restart runs `recoverAgentState()` | Same, plus backend-side cleanup via heartbeat expiry |
| Time to recover | Until daemon restarts | ~2 min for task recovery, daemon restart for agent respawn |

### F3: Duplicate auto-restart

| Step | Current | Proposed |
|------|---------|----------|
| Detection | None | Check for existing pending `start-agent` command |
| Recovery | Multiple stop+start pairs | Single restart, duplicates skipped |

### F4: Task stuck in `acknowledged`

| Step | Current | Proposed |
|------|---------|----------|
| Detection | Never | `cleanupStaleAgents` checks acknowledged tasks |
| Recovery | Manual | Auto: reset to `pending`, trigger auto-restart |
| Time to recover | ∞ | ~4 min (2 min timeout + 2 min cleanup cycle) |

### F5: Network partition (CLI loses WebSocket)

| Step | Current | Proposed |
|------|---------|----------|
| Detection | Never (no heartbeat) | Heartbeat fails → `readyUntil` expires |
| Recovery | None | Participant cleaned up, tasks recovered |
| Time to recover | ∞ | ~2 min |

### F6: Agent harness kills wait-for-task (timeout)

| Step | Current | Proposed |
|------|---------|----------|
| Detection | Never (no `leave()` call) | `leave()` called in exit handler + heartbeat expiry as backup |
| Recovery | None | Immediate via `leave()`, or 60s via heartbeat |

---

## Implementation Phases

### Phase 1: Heartbeat (P0, ~2 days)
1. Add `participants.heartbeat` mutation
2. Set `readyUntil` in `wait-for-task` on join
3. Add heartbeat interval (30s) in `wait-for-task`
4. Call `participants.leave` on all exit paths
5. Tests: verify heartbeat refresh, verify expiry triggers cleanup

### Phase 2: Process Death Monitoring (P0, ~1 day)
1. Add `child.on('exit')` in daemon's `handleStartAgent`
2. Clear PID in backend on unexpected exit
3. Tests: verify PID cleanup on process death

### Phase 3: Auto-Restart Dedup (P1, ~1 day)
1. Check for existing pending `start-agent` before inserting
2. Tests: verify no duplicate commands

### Phase 4: Task Timeout Recovery (P1, ~2 days)
1. Extend `cleanupStaleAgents` to check `pending` and `acknowledged` tasks
2. Add `recoverStuckAcknowledged` trigger to task FSM
3. Add timeout constants (configurable)
4. Tests: verify stuck task recovery

### Phase 5: Task Recovery via FSM (P2, ~0.5 day)
1. Replace `db.patch` in `recoverOrphanedTasks` with `transitionTask`
2. Add `recover` trigger to FSM

---

## Invariants (Provable Properties)

1. **Heartbeat invariant:** If an agent is alive, `readyUntil > now` is always true (refreshed every 30s, TTL 60s).
2. **Cleanup invariant:** If `readyUntil < now`, the participant WILL be removed within 2 minutes (cleanup runs every 2 min).
3. **Task recovery invariant:** If a task is `pending` or `acknowledged` and no valid participant exists for the target role, the task WILL be reset and auto-restart WILL be attempted within 4 minutes.
4. **Dedup invariant:** At most one pending `start-agent` command exists per role per chatroom at any time.
5. **Exit invariant:** When `wait-for-task` exits (any reason), `participants.leave` is called, providing immediate cleanup rather than waiting for heartbeat expiry.
