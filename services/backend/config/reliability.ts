/**
 * Agent Reliability Configuration
 *
 * Constants for heartbeat-based liveness detection and task recovery.
 * Used by both the backend (Convex functions) and CLI (wait-for-task).
 */

/** How often the CLI sends a heartbeat to refresh readyUntil (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long a participant is considered reachable after the last heartbeat (ms).
 *  Must be > HEARTBEAT_INTERVAL_MS to tolerate missed beats. Allows 2 missed beats. */
export const HEARTBEAT_TTL_MS = 90_000; // 90s (Plan 026: increased from 60s)

/** How long a task can be stuck in `pending` before triggering recovery (ms).
 *  For remote agents: triggers auto-restart. For custom agents: logs a warning. */
export const TASK_PENDING_TIMEOUT_MS = 300_000; // 5 min

/** How long a task can be stuck in `acknowledged` before being reset to `pending` (ms).
 *  If the assigned participant is missing or expired, the task is recovered. */
export const TASK_ACKNOWLEDGED_TIMEOUT_MS = 120_000; // 2 min

// ─── Daemon Heartbeat ────────────────────────────────────────────────────────

/** How often the daemon sends a heartbeat to refresh lastSeenAt (ms). */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long a daemon is considered alive after the last heartbeat (ms).
 *  Must be > DAEMON_HEARTBEAT_INTERVAL_MS to tolerate missed beats. Allows 3 missed beats. */
export const DAEMON_HEARTBEAT_TTL_MS = 120_000; // 2 min (Plan 026: increased from 90s)
