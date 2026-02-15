# Plan 026: Architecture — Heartbeat Self-Healing

## Changes Overview

Add self-healing recovery paths to the heartbeat system so that daemons and participants can automatically recover from transient disconnections. Also increase TTLs for greater tolerance of missed heartbeats.

## Self-Healing Invariant

> **If an agent or daemon resumes normal heartbeat communication, the system MUST return to a fully healthy state within one heartbeat cycle (≤30s), regardless of what cleanup actions occurred during the outage.**

This is the 7th provable invariant, extending the 6 defined in Plan 025.

---

## Sequence Diagrams

### Fix 1: Daemon Transient Disconnect Recovery

```
Daemon              Backend              Frontend
  │                    │                    │
  │──heartbeat────────▶│ lastSeenAt=now     │
  │                    │ daemonConnected=T   │
  │                    │                    │
  ✗ (network hiccup)  │                    │
                       │                    │
  (90s later)          │                    │
                       │ cleanupStaleAgents │
                       │ daemonConnected=F  │
                       │                    │──"No machines online"
  (network recovers)   │                    │
  │                    │                    │
  │──heartbeat────────▶│ lastSeenAt=now     │
  │                    │ daemonConnected=T  │ ← NEW: recovery
  │                    │                    │──machines online ✓
```

**Before:** `daemonHeartbeat` only updated `lastSeenAt`. After cleanup set `daemonConnected: false`, the daemon stayed "offline" forever.

**After:** `daemonHeartbeat` also sets `daemonConnected: true`, allowing automatic recovery.

### Fix 2: Participant Re-join After Cleanup

```
CLI Agent           Backend              CLI Agent (heartbeat callback)
  │                    │                    │
  │──heartbeat────────▶│ readyUntil=now+90s │
  │                    │                    │
  ✗ (network hiccup)  │                    │
                       │                    │
  (90s later)          │                    │
                       │ cleanupStaleAgents │
                       │ DELETE participant │
                       │                    │
  (network recovers)   │                    │
  │                    │                    │
  │──heartbeat────────▶│ participant=null   │
  │                    │ return {status:    │
  │◀─────────────────  │  'rejoin_required'}│
  │                    │                    │
  │  (heartbeat callback sees 'rejoin_required')
  │                    │                    │
  │──join()───────────▶│ INSERT participant │
  │                    │ status='waiting'   │
  │                    │ readyUntil=now+90s │
  │                    │                    │
  │──heartbeat────────▶│ readyUntil=now+90s │ (normal cycle resumes)
```

**Before:** Heartbeat found no participant → logged warning → silently returned. CLI had no signal to re-join. Warnings repeated every 30s forever.

**After:** Heartbeat returns `{ status: 'rejoin_required' }`. CLI heartbeat callback calls `join()` to re-create the participant. Normal operation resumes.

### Race Condition Analysis: Re-join vs Cleanup Loop

```
Timeline:
  T+0s    CLI heartbeat → rejoin_required → join() → readyUntil = T+90s
  T+30s   CLI heartbeat → ok → readyUntil = T+120s
  T+60s   CLI heartbeat → ok → readyUntil = T+150s
  T+120s  cleanupStaleAgents runs → readyUntil(T+150s) > now(T+120s) → SKIP ✓
```

No loop occurs because `join()` sets `readyUntil = now + HEARTBEAT_TTL_MS`, giving the participant a full TTL window of protection. Subsequent heartbeats keep refreshing it.

---

## Modified Components

### `daemonHeartbeat` (Backend Mutation — `machines.ts`)

**Change:** Also set `daemonConnected: true` when updating `lastSeenAt`.

```typescript
// Before:
await ctx.db.patch('chatroom_machines', machine._id, {
  lastSeenAt: Date.now(),
});

// After:
await ctx.db.patch('chatroom_machines', machine._id, {
  lastSeenAt: Date.now(),
  daemonConnected: true,
});
```

**Rationale:** A daemon that can send a heartbeat is, by definition, connected. This is a 1-line change with no side effects — `daemonConnected` is already a boolean field on the schema.

### `participants.heartbeat` (Backend Mutation — `participants.ts`)

**Change:** Return a status object instead of `void`. When participant is not found, return `{ status: 'rejoin_required' }`.

```typescript
// Before:
if (!participant) {
  console.warn(`[heartbeat] Participant ${args.role} not found — ignoring stale heartbeat`);
  return;
}
// ... refresh readyUntil ...

// After:
if (!participant) {
  console.warn(`[heartbeat] Participant ${args.role} not found — signaling re-join`);
  return { status: 'rejoin_required' as const };
}
// ... refresh readyUntil ...
return { status: 'ok' as const };
```

**Rationale:** Returning a signal lets the CLI decide how to handle recovery, keeping the logic in `join()` where it belongs (with task recovery, queue promotion, etc.).

### `wait-for-task` Heartbeat Callback (CLI — `wait-for-task.ts`)

**Change:** Check heartbeat response and call `join()` if re-join is required.

```typescript
// In the heartbeat interval callback:
const result = await client.mutation(api.participants.heartbeat, {
  sessionId,
  chatroomId,
  role,
  connectionId,
});

if (result?.status === 'rejoin_required') {
  console.warn(`[heartbeat] Participant record missing — re-joining chatroom`);
  await client.mutation(api.participants.join, {
    sessionId,
    chatroomId,
    role,
    readyUntil: Date.now() + HEARTBEAT_TTL_MS,
    connectionId,
  });
}
```

**Rationale:** Re-uses the existing `join()` path which handles all the complex logic (state recovery, queue promotion, connectionId tracking).

### `reliability.ts` (Config)

**Change:** Increase TTLs for more tolerance.

```typescript
// Before:
export const HEARTBEAT_TTL_MS = 60_000;   // 1 min (tolerates 1 missed beat)
export const DAEMON_HEARTBEAT_TTL_MS = 90_000; // 90s (tolerates 2 missed beats)

// After:
export const HEARTBEAT_TTL_MS = 90_000;   // 90s (tolerates 2 missed beats)
export const DAEMON_HEARTBEAT_TTL_MS = 120_000; // 2 min (tolerates 3 missed beats)
```

**Rationale:** With 30s heartbeat intervals, a 60s TTL only tolerates 1 missed beat. During Convex function redeployments (which can take 4-5s), a heartbeat might be delayed enough to cause a false positive. 90s gives a comfortable 2-beat buffer.

---

## New Contracts

### `participants.heartbeat` Return Type

```typescript
// Return type changes from void to:
type HeartbeatResult = 
  | { status: 'ok' }
  | { status: 'rejoin_required' };
```

### No Schema Changes

All changes are behavioral. No new fields, tables, or indexes required.

---

## Updated Provable Invariants

Adding to the 6 invariants from Plan 025:

7. **Self-healing invariant:** If an agent or daemon resumes normal heartbeat communication, the system returns to a fully healthy state within one heartbeat cycle (≤30s), regardless of what cleanup actions occurred during the outage.

This invariant is satisfied because:
- Daemon: heartbeat sets `daemonConnected: true` → immediate recovery
- Participant: heartbeat returns `rejoin_required` → CLI calls `join()` → participant re-created with fresh `readyUntil`
