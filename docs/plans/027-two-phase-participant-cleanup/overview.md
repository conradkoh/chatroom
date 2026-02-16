# Plan 027: Two-Phase Participant Cleanup

## Summary

Replace the immediate-delete behavior in `cleanupStaleAgents` with a two-phase approach that introduces a `planned_cleanup` intermediate state. When the cron detects a stale participant, instead of deleting immediately, it marks the participant as `planned_cleanup` with a deadline. If the agent's heartbeat arrives before the deadline, the participant is restored to `waiting`. Only after the deadline passes does the next cron run actually delete the record.

This eliminates the race condition where a live agent is deleted between heartbeat cycles and then fails with `PARTICIPANT_NOT_FOUND` during task delivery.

## Goals

1. **Eliminate the cleanup race condition** — Ensure that a live agent is never deleted by `cleanupStaleAgents` while it is still heartbeating, even if a single heartbeat is delayed or missed
2. **Preserve self-healing semantics** — Maintain Plan 026's self-healing guarantees while adding a safety buffer before deletion
3. **Observable cleanup intent** — Make the pending cleanup visible to the system (and optionally the UI) so that operators can understand why an agent might briefly appear in an intermediate state
4. **Minimal state model changes** — Reuse the existing participant status field with one new value rather than introducing a separate cleanup tracking system

## Non-Goals

1. Changes to the heartbeat interval or TTL values — These are already tuned in Plan 026
2. Changes to task recovery logic — Task FSM transitions remain unchanged
3. UI changes — While `planned_cleanup` could be surfaced in the UI, that's a separate concern
4. Changes to daemon crash recovery — The daemon lifecycle is unaffected

## Background

Plan 025 introduced heartbeat-based liveness detection. Plan 026 added self-healing so agents can automatically re-join after cleanup. However, a race condition remains:

1. Agent heartbeat TTL expires (e.g., due to network delay or harness backgrounding `wait-for-task`)
2. `cleanupStaleAgents` cron fires and immediately deletes the participant record
3. Before the agent's next heartbeat can trigger a re-join, a task arrives
4. The CLI tries to call `updateStatus` to transition to `active` → `PARTICIPANT_NOT_FOUND`

The fix is to delay deletion by introducing a grace period during which the agent can prove it's still alive.

## Relationship to Prior Plans

- **Plan 025 (Agent Reliability System Design):** Introduced `cleanupStaleAgents` with immediate-delete semantics
- **Plan 026 (Heartbeat Self-Healing):** Added `rejoin_required` return from heartbeat and increased TTLs. This plan extends the cleanup to be two-phase, making re-join unnecessary in most cases because the agent is never deleted while alive
