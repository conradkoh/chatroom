# Plan 026: Heartbeat Self-Healing + Agent Status FSM

## Summary

This plan addresses three design gaps discovered in the heartbeat reliability system (Plan 025) that cause daemons and participants to become permanently disconnected after transient issues. It also introduces a formal **Agent Status FSM** to replace the current ad-hoc status derivation, ensuring the UI always shows an accurate, authoritative agent status.

## Goals

1. **Daemon self-healing** — A daemon that resumes heartbeating after a transient disconnect MUST recover its `daemonConnected: true` status automatically
2. **Participant self-healing** — A CLI agent whose participant record was deleted by cleanup MUST be able to re-join automatically via the heartbeat signal
3. **Self-healing invariant** — Formalize the guarantee that the system returns to a healthy state within one heartbeat cycle after transient issues resolve
4. **Increased tolerance** — Adjust TTLs to reduce false positives from transient network delays
5. **Agent Status FSM** — Replace derived agent status with an explicit, stored FSM state that tracks the full lifecycle: offline → ready → working → dead → restarting → dead_failed_revive
6. **Crash recovery visibility** — When the daemon is restarting an agent, the UI shows "RESTARTING". When all attempts fail, the UI shows "DEAD (UNRECOVERABLE)".

## Non-Goals

1. Changes to the cleanup logic itself (delete behavior is correct)
2. Changes to the auto-restart mechanism (already implemented in daemon)
3. Changes to task recovery or FSM transitions (task FSM is separate from agent FSM)

## Background

Plan 025 introduced heartbeat-based liveness detection with cleanup of stale participants and daemons. While the detection and cleanup work correctly, three gaps were identified:

- **Gap 1:** `daemonHeartbeat` only updates `lastSeenAt` but never sets `daemonConnected: true`, so a daemon marked disconnected by cleanup can never recover without a full restart
- **Gap 2:** `cleanupStaleAgents` deletes participant records, but the heartbeat mutation silently ignores missing participants without signaling the CLI to re-join
- **Gap 3:** No formal "self-healing invariant" was defined, so recovery paths were never designed

Additionally, the agent crash recovery feature (implemented in `daemon-start.ts`) revealed a fourth gap:

- **Gap 4:** Agent status in the UI is derived from participant records and expiration checks, not stored explicitly. This means the UI cannot distinguish between "agent is being restarted" and "agent is offline", nor can it show "all restart attempts failed."

## Relationship to Prior Plans

- **Plan 020 (Task Lifecycle Reliability):** Introduced `cleanupStaleAgents` with "reset to idle" semantics. This plan keeps the delete approach (cleaner) but adds the missing re-join signal.
- **Plan 025 (Agent Reliability System Design):** Introduced heartbeat infrastructure and daemon liveness detection. This plan extends it with recovery paths, a new invariant, and the Agent Status FSM.
- **Agent Crash Recovery (feat branch):** Introduced daemon-side crash recovery with retry logic. This plan adds backend status reporting so the UI reflects the recovery process.
