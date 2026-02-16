# Plan 027: PRD — Two-Phase Participant Cleanup

## Glossary

| Term | Definition |
|------|------------|
| **Planned Cleanup** | A participant state indicating that the cron has flagged this agent for removal, but deletion is deferred until a deadline passes |
| **Cleanup Deadline** | A timestamp (`cleanupDeadline`) set when a participant enters `planned_cleanup` state. Once `now > cleanupDeadline`, the participant will be deleted on the next cron run |
| **Two-Phase Cleanup** | The pattern of marking for cleanup (phase 1) then deleting (phase 2), with a window in between for the agent to cancel the cleanup via heartbeat |
| **Heartbeat Recovery** | When a heartbeat arrives for a participant in `planned_cleanup` state, the participant is restored to `waiting` with refreshed `readyUntil` |

## User Stories

### US-1: Agent survives transient heartbeat miss
**As a** CLI agent running `wait-for-task`,
**I want** the system to give me a grace period before deleting my participant record,
**So that** a single missed heartbeat (due to network delay, harness timeout, etc.) doesn't cause task delivery to fail with `PARTICIPANT_NOT_FOUND`.

**Acceptance Criteria:**
- When my heartbeat TTL expires, my participant status changes to `planned_cleanup` (not deleted)
- If my next heartbeat arrives before the cleanup deadline, my status is restored to `waiting`
- I never see `PARTICIPANT_NOT_FOUND` errors during normal operation with intermittent delays

### US-2: Truly stale agents are still cleaned up
**As a** system operator,
**I want** agents that have genuinely disconnected to be cleaned up after the grace period,
**So that** stale participant records don't accumulate indefinitely.

**Acceptance Criteria:**
- If no heartbeat arrives within the cleanup deadline (default: 60 seconds), the participant is deleted on the next cron run
- The total time from staleness detection to deletion is at most: cron interval + cleanup deadline + cron interval (~5 minutes worst case)

### US-3: Task delivery works during planned cleanup
**As a** CLI agent in `planned_cleanup` state,
**I want** task delivery to still work if a task arrives while I'm flagged for cleanup,
**So that** the race condition between cleanup and task delivery is eliminated.

**Acceptance Criteria:**
- `updateStatus` mutation handles `planned_cleanup` participants (either by allowing the transition or by first restoring to `waiting`)
- Task processing paths don't encounter `PARTICIPANT_NOT_FOUND` for agents in `planned_cleanup` state
