# Plan 025: Implementation Phases

## Phase Breakdown

### Phase 1: Heartbeat Infrastructure (P0)

**Goal:** Establish heartbeat-based liveness detection for all agents using `wait-for-task`.

**Changes:**
1. Add `participants.heartbeat` mutation in `services/backend/convex/participants.ts`
2. Update `wait-for-task` CLI to set `readyUntil` on `participants.join`
3. Add heartbeat interval (30s) in `wait-for-task` CLI
4. Add `participants.leave` call on all exit paths in `wait-for-task`
5. Add heartbeat configuration constants

**Files:**
- `services/backend/convex/participants.ts` — new `heartbeat` mutation
- `packages/cli/src/commands/wait-for-task.ts` — heartbeat timer + leave on exit
- `services/backend/config/reliability.ts` — new config file for constants

**Success Criteria:**
- `readyUntil` is always set when `wait-for-task` is running
- `readyUntil` refreshes every 30s
- `readyUntil` stops refreshing when process exits
- `participants.leave` is called on normal exit, signal, and error
- Existing tests pass; new tests verify heartbeat behavior

**Estimated Effort:** 2 days

---

### Phase 2: Process Death Monitoring (P0)

**Goal:** Detect when a daemon-spawned agent process dies unexpectedly and clean up immediately.

**Changes:**
1. Add `child.on('exit')` handler in daemon's `handleStartAgent`
2. On unexpected exit: clear `spawnedAgentPid` in backend
3. Optionally: call a backend mutation to mark the agent as disconnected

**Files:**
- `packages/cli/src/commands/machine/daemon-start.ts` — exit handler
- `services/backend/convex/machines.ts` — mutation to clear spawned agent

**Success Criteria:**
- When an agent process exits, PID is cleared within seconds
- UI reflects the agent as stopped (not running)
- Daemon logs the unexpected exit with code and signal

**Estimated Effort:** 1 day

---

### Phase 3: Auto-Restart Deduplication (P1)

**Goal:** Prevent multiple concurrent auto-restart commands for the same role.

**Changes:**
1. In `autoRestartOfflineAgent`, query for existing pending `start-agent` commands for the target role
2. Skip restart if a pending command already exists
3. Add index on `chatroom_machineCommands` for efficient lookup (if needed)

**Files:**
- `services/backend/convex/messages.ts` — dedup check in `autoRestartOfflineAgent`
- `services/backend/convex/schema.ts` — optional: add index

**Success Criteria:**
- Sending 5 messages to an offline agent produces at most 1 stop+start pair
- Existing auto-restart behavior is preserved for the first trigger
- Integration test verifies dedup

**Estimated Effort:** 1 day

---

### Phase 4: Task Timeout Recovery (P1)

**Goal:** Automatically recover tasks stuck in `pending` or `acknowledged` when the target agent is unreachable.

**Changes:**
1. Extend `cleanupStaleAgents` to check for stuck tasks after participant cleanup
2. Add `recoverStuckAcknowledged` trigger to task FSM (`acknowledged` → `pending`)
3. For `pending` tasks past timeout: check agent type → auto-restart (remote) or notify (custom)
4. Add timeout constants to config

**Files:**
- `services/backend/convex/tasks.ts` — extended cleanup logic
- `services/backend/convex/lib/taskStateMachine.ts` — new FSM trigger
- `services/backend/config/reliability.ts` — timeout constants

**Success Criteria:**
- Task stuck in `acknowledged` for >2 min is reset to `pending`
- Task stuck in `pending` for >5 min with no participant triggers recovery
- Remote agents get auto-restarted; custom agents get user notification
- Integration tests verify both timeout scenarios

**Estimated Effort:** 2 days

---

### Phase 5: Formalize Task Recovery via FSM (P2)

**Goal:** Ensure all task state transitions go through the FSM, including recovery operations.

**Changes:**
1. Replace `db.patch` in `recoverOrphanedTasks` with `transitionTask`
2. Add `recoverOrphaned` trigger to FSM (`in_progress` → `pending`)
3. Audit all task status changes for FSM compliance

**Files:**
- `services/backend/convex/lib/taskRecovery.ts` — use FSM transitions
- `services/backend/convex/lib/taskStateMachine.ts` — new trigger

**Success Criteria:**
- All task state changes go through `transitionTask`
- No direct `db.patch` of `status` field outside the FSM
- Existing recovery tests pass

**Estimated Effort:** 0.5 day

---

## Phase Dependencies

```
Phase 1 (Heartbeat) ──────────────────────▶ Phase 4 (Task Timeout)
                                                    │
Phase 2 (Process Death) ──── independent            │
                                                    ▼
Phase 3 (Dedup) ──────────── independent      Phase 5 (FSM Formalization)
```

- **Phase 1** must complete before Phase 4 (task timeout depends on heartbeat for participant expiry)
- **Phase 2** and **Phase 3** are independent and can run in parallel with Phase 1
- **Phase 5** should come after Phase 4 (builds on the new FSM triggers)

## Total Estimated Effort

| Phase | Effort | Priority |
|-------|--------|----------|
| Phase 1: Heartbeat | 2 days | P0 |
| Phase 2: Process Death | 1 day | P0 |
| Phase 3: Dedup | 1 day | P1 |
| Phase 4: Task Timeout | 2 days | P1 |
| Phase 5: FSM Formalization | 0.5 day | P2 |
| **Total** | **6.5 days** | |
