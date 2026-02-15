# Plan 026: Heartbeat Self-Healing

## Summary

This plan addresses three design gaps discovered in the heartbeat reliability system (Plan 025) that cause daemons and participants to become permanently disconnected after transient issues. The core problem: cleanup mechanisms permanently alter state (`daemonConnected: false`, participant deletion) without corresponding recovery paths when normal operation resumes.

## Goals

1. **Daemon self-healing** — A daemon that resumes heartbeating after a transient disconnect MUST recover its `daemonConnected: true` status automatically
2. **Participant self-healing** — A CLI agent whose participant record was deleted by cleanup MUST be able to re-join automatically via the heartbeat signal
3. **Self-healing invariant** — Formalize the guarantee that the system returns to a healthy state within one heartbeat cycle after transient issues resolve
4. **Increased tolerance** — Adjust TTLs to reduce false positives from transient network delays

## Non-Goals

1. Changes to the cleanup logic itself (delete behavior is correct)
2. Changes to the auto-restart mechanism
3. UI changes for daemon/participant status display
4. Changes to task recovery or FSM transitions

## Background

Plan 025 introduced heartbeat-based liveness detection with cleanup of stale participants and daemons. While the detection and cleanup work correctly, three gaps were identified:

- **Gap 1:** `daemonHeartbeat` only updates `lastSeenAt` but never sets `daemonConnected: true`, so a daemon marked disconnected by cleanup can never recover without a full restart
- **Gap 2:** `cleanupStaleAgents` deletes participant records (diverging from Plan 020's "reset to idle" approach), but the heartbeat mutation silently ignores missing participants without signaling the CLI to re-join
- **Gap 3:** No formal "self-healing invariant" was defined, so recovery paths were never designed

## Relationship to Prior Plans

- **Plan 020 (Task Lifecycle Reliability):** Introduced `cleanupStaleAgents` with "reset to idle" semantics. This plan keeps the delete approach (cleaner) but adds the missing re-join signal.
- **Plan 025 (Agent Reliability System Design):** Introduced heartbeat infrastructure and daemon liveness detection. This plan extends it with recovery paths and a new invariant.
