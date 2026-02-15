# Plan 026: Implementation Phases

## Phase Breakdown

### Phase 1: Daemon Heartbeat Recovery (P0) ✅ DONE

**Goal:** Allow daemons to recover their `daemonConnected` status via heartbeat.

**Changes:**
1. In `daemonHeartbeat` mutation (`machines.ts`), add `daemonConnected: true` to the patch

**Files:**
- `services/backend/convex/machines.ts` — 1-line change in `daemonHeartbeat`

**Success Criteria:**
- After `cleanupStaleAgents` marks a daemon as disconnected, the next heartbeat restores `daemonConnected: true`
- Frontend immediately reflects the daemon as online
- Existing tests pass

**Estimated Effort:** 0.5 hours

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

**Success Criteria:**
- After `cleanupStaleAgents` deletes a participant, the next heartbeat triggers a re-join
- "Participant not found" warnings stop after one occurrence (followed by successful re-join)
- Agent remains reachable for task assignment after re-join
- Existing tests pass; new tests verify re-join behavior

**Estimated Effort:** 2 hours

---

### Phase 3: Increase TTLs (P1) ✅ DONE

**Goal:** Reduce false positive cleanup triggers during transient delays.

**Changes:**
1. Increase `HEARTBEAT_TTL_MS` from 60s to 90s
2. Increase `DAEMON_HEARTBEAT_TTL_MS` from 90s to 120s

**Files:**
- `services/backend/config/reliability.ts` — update constants

**Success Criteria:**
- System tolerates 2 missed heartbeats (participant) and 3 missed heartbeats (daemon) before cleanup
- Existing tests pass (update any tests that assert specific TTL values)

**Estimated Effort:** 0.5 hours

---

## Phase Dependencies

```
Phase 1 (Daemon Recovery) ──── independent
Phase 2 (Re-join Signal) ──── independent
Phase 3 (TTL Increase) ─────── independent
```

All three phases are independent and can be implemented in any order. However, implementing Phase 1 and Phase 2 first provides the most immediate bug fix value.

## Total Estimated Effort

| Phase | Effort | Priority | Status |
|-------|--------|----------|--------|
| Phase 1: Daemon Recovery | 0.5 hours | P0 | ✅ Done |
| Phase 2: Re-join Signal | 2 hours | P0 | ✅ Done |
| Phase 3: TTL Increase | 0.5 hours | P1 | ✅ Done |
| **Total** | **3 hours** | | |
