# Plan 027: Phases — Two-Phase Participant Cleanup

## Phase Breakdown

### Phase 1: Schema and Config Changes
Add the new status value and field to the schema, and the new timing constant.

**Changes:**
1. Update `services/backend/convex/schema.ts` — Add `'planned_cleanup'` to participant status union, add optional `cleanupDeadline` field
2. Update `services/backend/config/reliability.ts` — Add `CLEANUP_GRACE_PERIOD_MS = 60_000`
3. Update `services/backend/config/participantStates.ts` — Add `'planned_cleanup'` to relevant state lists (NOT `DEAD_STATES`)

**Success Criteria:**
- Schema accepts the new status and field
- Type checks pass
- Existing functionality is unaffected

### Phase 2: Modify `cleanupStaleAgents` Cron
Convert the immediate-delete behavior to two-phase.

**Changes:**
1. Modify `services/backend/convex/tasks.ts` `cleanupStaleAgents`:
   - Stale `waiting`/`active` participants → patch to `planned_cleanup` with `cleanupDeadline` instead of delete
   - Add new loop: `planned_cleanup` participants past deadline → delete
   - Orphaned task recovery for stale `active` still happens before marking as `planned_cleanup`

**Success Criteria:**
- Stale participants are marked as `planned_cleanup` instead of immediately deleted
- Participants in `planned_cleanup` past their deadline are deleted
- Orphaned tasks from stale `active` participants are still recovered
- Logging reflects the two-phase behavior

### Phase 3: Modify Heartbeat and Status Mutations
Allow heartbeat to restore `planned_cleanup` participants and `updateStatus` to handle them.

**Changes:**
1. Modify `services/backend/convex/participants.ts` `heartbeat`:
   - If `participant.status === 'planned_cleanup'` → patch to `waiting`, clear `cleanupDeadline`, refresh `readyUntil`, return `{ status: 'ok' }`
2. Modify `services/backend/convex/participants.ts` `updateStatus`:
   - If participant is in `planned_cleanup` state → allow the status transition (clear `cleanupDeadline` as part of the update)

**Success Criteria:**
- A heartbeat arriving for a `planned_cleanup` participant restores it to `waiting`
- `updateStatus` succeeds for `planned_cleanup` participants (no `PARTICIPANT_NOT_FOUND`)
- The race condition between cleanup and task delivery is eliminated

## Phase Dependencies

```
Phase 1 (Schema + Config)
  └─→ Phase 2 (Cron Changes)
  └─→ Phase 3 (Mutation Changes)
```

Phase 2 and Phase 3 both depend on Phase 1 but are independent of each other. However, for a single commit, implementing them sequentially (1 → 2 → 3) is recommended.

## Success Criteria (Overall)

1. **No race condition:** An agent with intermittent heartbeat delays never encounters `PARTICIPANT_NOT_FOUND` during task delivery
2. **Stale cleanup still works:** Genuinely disconnected agents are removed after the grace period
3. **Type safety:** All status checks and state lists account for the new `planned_cleanup` status
4. **Backward compatible:** Existing participants in `waiting`/`active` states continue to work unchanged
5. **Logging:** The two-phase cleanup is observable via console warnings
