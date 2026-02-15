# Plan 026: Implementation Phases

## Completed Phases (Original Plan 026)

### Phase 1: Daemon Heartbeat Recovery (P0) ✅ DONE

**Goal:** Allow daemons to recover their `daemonConnected` status via heartbeat.

**Changes:**
1. In `daemonHeartbeat` mutation (`machines.ts`), add `daemonConnected: true` to the patch

**Files:**
- `services/backend/convex/machines.ts` — 1-line change in `daemonHeartbeat`

---

### Phase 2: Participant Heartbeat Re-join Signal (P0) ✅ DONE

**Goal:** Signal CLI agents to re-join when their participant record has been deleted.

**Changes:**
1. Modify `participants.heartbeat` to return `{ status: 'rejoin_required' }` when participant not found
2. Modify `participants.heartbeat` to return `{ status: 'ok' }` on success
3. Update `wait-for-task` heartbeat callback to check response and call `join()` if needed

**Files:**
- `services/backend/convex/participants.ts` — return status from heartbeat
- `packages/cli/src/commands/wait-for-task.ts` — handle re-join signal in heartbeat callback

---

### Phase 3: Increase TTLs (P1) ✅ DONE

**Goal:** Reduce false positive cleanup triggers during transient delays.

**Changes:**
1. Increase `HEARTBEAT_TTL_MS` from 60s to 90s
2. Increase `DAEMON_HEARTBEAT_TTL_MS` from 90s to 120s

**Files:**
- `services/backend/config/reliability.ts` — update constants

---

## New Phases (Agent Status FSM)

### Phase 4: Schema + Backend — Add `agentStatus` Field (P0)

**Goal:** Add the `agentStatus` field to the `chatroom_participants` schema and create the `updateAgentStatus` mutation.

**Changes:**
1. Add `agentStatus` optional field to `chatroom_participants` schema
2. Create `participants.updateAgentStatus` mutation with FSM validation
3. Update `participants.join` to set `agentStatus: 'ready'` on join
4. Update `participants.updateStatus` to sync `agentStatus` (`active` → `working`, `waiting` → `ready`)
5. Update `participants.leave` to set `agentStatus: 'offline'` before deleting (or keep record with status)
6. Update `getTeamReadiness` to include `agentStatus` in participant info with backward-compat fallback

**Files:**
- `services/backend/convex/schema.ts` — add `agentStatus` field
- `services/backend/convex/participants.ts` — new mutation + update existing mutations
- `services/backend/convex/chatrooms.ts` — update `getTeamReadiness`

**Success Criteria:**
- `agentStatus` is set correctly on join, status update, and leave
- `getTeamReadiness` returns `agentStatus` for each participant
- Backward compatibility: participants without `agentStatus` get a derived value
- Existing tests pass; new tests verify FSM transitions

**Estimated Effort:** 3 hours

---

### Phase 5: Daemon — Report Status During Crash Recovery (P0)

**Goal:** The daemon reports `restarting` and `dead_failed_revive` statuses to the backend during crash recovery.

**Changes:**
1. After `participants.leave`, call `participants.updateAgentStatus` with `restarting`
2. After all restart attempts fail, call `participants.updateAgentStatus` with `dead_failed_revive`
3. Ensure the participant record exists (create if needed) to hold the status

**Files:**
- `packages/cli/src/commands/machine/daemon-start.ts` — update `handleAgentCrashRecovery`

**Dependencies:** Phase 4 (needs `updateAgentStatus` mutation)

**Success Criteria:**
- When an agent crashes, the backend shows `restarting` within seconds
- When all restarts fail, the backend shows `dead_failed_revive`
- Manual restart from UI transitions back to `ready` via `join()`
- Existing tests pass

**Estimated Effort:** 1.5 hours

---

### Phase 6: CLI — Set `agentStatus` at Lifecycle Points (P0)

**Goal:** The CLI sets `agentStatus` at all lifecycle transitions (join, task start, task complete, leave).

**Changes:**
1. `wait-for-task`: Set `agentStatus: 'ready'` on join (may already be handled by Phase 4)
2. `task-started`: Set `agentStatus: 'working'` when claiming a task
3. `handoff` / `task-complete`: Set `agentStatus: 'ready'` when returning to waiting
4. Graceful stop: Set `agentStatus: 'offline'` on leave

**Files:**
- `packages/cli/src/commands/wait-for-task.ts` — set on join/leave
- `packages/cli/src/commands/task-started.ts` — set on task claim
- `packages/cli/src/commands/handoff.ts` — set on handoff
- `packages/cli/src/commands/task-complete.ts` — set on task complete

**Dependencies:** Phase 4 (needs `updateAgentStatus` mutation)

**Success Criteria:**
- `agentStatus` transitions correctly through the full lifecycle: offline → ready → working → ready → offline
- Heartbeat re-join also sets `agentStatus: 'ready'`
- Existing tests pass

**Estimated Effort:** 2 hours

---

### Phase 7: Backend Cleanup — Set `dead` on Expiration (P1)

**Goal:** The cleanup cron sets `agentStatus: 'dead'` when it detects expired participants.

**Changes:**
1. In `cleanupStaleAgents`, before deleting an expired participant, set `agentStatus: 'dead'`
2. Alternatively, instead of deleting, mark as `dead` and let a separate cleanup handle deletion after a grace period

**Files:**
- `services/backend/convex/tasks.ts` — update `cleanupStaleAgents`

**Dependencies:** Phase 4

**Success Criteria:**
- Expired participants show as "DEAD" in the UI before being cleaned up
- Task recovery still works correctly
- Existing tests pass

**Estimated Effort:** 1 hour

---

### Phase 8: Frontend — Update Status Display (P1)

**Goal:** Update the frontend to read `agentStatus` and display the new states.

**Changes:**
1. Update `AgentStatus` type to include all 6 FSM states
2. Update `STATUS_CONFIG` with labels and colors for new states
3. Update `getEffectiveStatus` to prefer `agentStatus` over derived status
4. Update `ParticipantInfo` type to include `agentStatus`
5. Update `AgentPanel` categorization logic for new states

**Files:**
- `apps/webapp/src/modules/chatroom/types/readiness.ts` — update types
- `apps/webapp/src/modules/chatroom/components/AgentPanel.tsx` — update status display

**Dependencies:** Phase 4 (backend returns `agentStatus`)

**Success Criteria:**
- UI shows "RESTARTING" when daemon is restarting an agent
- UI shows "DEAD (UNRECOVERABLE)" when all restart attempts fail
- UI shows "DEAD" when heartbeat expires
- Backward compat: agents without `agentStatus` still show correct derived status
- Dark mode verified for all new status colors

**Estimated Effort:** 2 hours

---

## Phase Dependencies

```
Phase 1 (Daemon Recovery) ──── ✅ DONE
Phase 2 (Re-join Signal) ──── ✅ DONE
Phase 3 (TTL Increase) ─────── ✅ DONE

Phase 4 (Schema + Backend) ────┬── NEW (foundation)
                                │
Phase 5 (Daemon Status) ───────┤── depends on Phase 4
Phase 6 (CLI Lifecycle) ───────┤── depends on Phase 4
Phase 7 (Cleanup Cron) ────────┤── depends on Phase 4
Phase 8 (Frontend Display) ────┘── depends on Phase 4
```

Phase 4 is the foundation. Phases 5-8 can be implemented in parallel after Phase 4 is complete.

## Total Estimated Effort

| Phase | Effort | Priority | Status |
|-------|--------|----------|--------|
| Phase 1: Daemon Recovery | 0.5 hours | P0 | ✅ Done |
| Phase 2: Re-join Signal | 2 hours | P0 | ✅ Done |
| Phase 3: TTL Increase | 0.5 hours | P1 | ✅ Done |
| Phase 4: Schema + Backend | 3 hours | P0 | Planned |
| Phase 5: Daemon Status | 1.5 hours | P0 | Planned |
| Phase 6: CLI Lifecycle | 2 hours | P0 | Planned |
| Phase 7: Cleanup Cron | 1 hour | P1 | Planned |
| Phase 8: Frontend Display | 2 hours | P1 | Planned |
| **Total** | **12.5 hours** | | |
