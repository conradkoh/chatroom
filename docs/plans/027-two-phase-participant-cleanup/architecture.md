# Plan 027: Architecture — Two-Phase Participant Cleanup

## Changes Overview

This plan modifies the participant cleanup lifecycle by introducing a `planned_cleanup` intermediate state. The core change is in `cleanupStaleAgents` (cron) and the heartbeat/join/updateStatus mutations.

## Modified Components

### 1. `services/backend/convex/tasks.ts` — `cleanupStaleAgents`

**Current behavior:** Stale `waiting`/`active` participants → immediate `ctx.db.delete()`

**New behavior (two-phase):**
- **Phase 1:** Stale `waiting`/`active` participants → `patch({ status: 'planned_cleanup', cleanupDeadline: now + CLEANUP_GRACE_PERIOD_MS })`
- **Phase 2:** Participants with `status === 'planned_cleanup'` and `now > cleanupDeadline` → `ctx.db.delete()`

Orphaned task recovery for stale `active` participants still happens in Phase 1 (before marking as planned_cleanup) to ensure tasks are not stuck.

### 2. `services/backend/convex/participants.ts` — `heartbeat`

**Current behavior:** If participant not found → return `{ status: 'rejoin_required' }`

**New behavior:** If `participant.status === 'planned_cleanup'` → restore to `waiting`, clear `cleanupDeadline`, refresh `readyUntil`, return `{ status: 'ok' }`

### 3. `services/backend/convex/participants.ts` — `join`

**Current behavior:** If existing participant found → patch to `waiting`

**New behavior:** No change needed — the existing `join` already patches status to `waiting` for any existing participant, which naturally handles `planned_cleanup` participants.

### 4. `services/backend/convex/participants.ts` — `updateStatus`

**Current behavior:** If participant not found → throw `PARTICIPANT_NOT_FOUND`

**New behavior:** If `participant.status === 'planned_cleanup'` → allow the transition (treat as if the participant is `waiting`). This handles the race where a task arrives while the agent is flagged for cleanup.

### 5. `services/backend/config/reliability.ts`

**New constant:** `CLEANUP_GRACE_PERIOD_MS = 60_000` (1 minute)

This is the time between marking a participant as `planned_cleanup` and actually deleting it. Must be > `HEARTBEAT_INTERVAL_MS` (30s) to ensure at least one heartbeat cycle can occur.

### 6. `services/backend/config/participantStates.ts`

Add `'planned_cleanup'` to the appropriate state lists. It should NOT be in `DEAD_STATES` since the agent may still be alive.

### 7. Schema (`services/backend/convex/schema.ts`)

Add `'planned_cleanup'` to the `status` union type for `chatroom_participants`.
Add optional `cleanupDeadline` field (number) to `chatroom_participants`.

## New Contracts

```typescript
/** New constant in reliability.ts */
export const CLEANUP_GRACE_PERIOD_MS = 60_000; // 1 min

/** Updated participant status type (conceptual — actual is in Convex schema) */
type ParticipantStatus =
  | 'waiting'
  | 'active'
  | 'offline'
  | 'dead'
  | 'restarting'
  | 'dead_failed_revive'
  | 'planned_cleanup'; // NEW

/** Updated chatroom_participants schema fields */
interface ChatroomParticipant {
  // ... existing fields ...
  cleanupDeadline?: number; // NEW: timestamp when planned_cleanup expires
}
```

## Modified Contracts

The `chatroom_participants.status` field gains one new value: `'planned_cleanup'`.

The `chatroom_participants` table gains one new optional field: `cleanupDeadline` (number).

## Data Flow Changes

```
Before (immediate delete):
  Cron detects stale → DELETE → agent heartbeats → rejoin_required → re-join
                                                 ↘ task arrives → PARTICIPANT_NOT_FOUND ❌

After (two-phase):
  Cron detects stale → planned_cleanup (deadline=now+60s)
                       ├─ agent heartbeats → restore to waiting ✅
                       ├─ task arrives → updateStatus allows transition ✅
                       └─ no heartbeat by deadline → next cron → DELETE ✅
```
