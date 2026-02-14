/**
 * Agent Reliability Configuration
 *
 * Constants for heartbeat-based liveness detection and task recovery.
 * Used by both the backend (Convex functions) and CLI (wait-for-task).
 */

/** How often the CLI sends a heartbeat to refresh readyUntil (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** How long a participant is considered reachable after the last heartbeat (ms).
 *  Must be > HEARTBEAT_INTERVAL_MS to tolerate one missed beat. */
export const HEARTBEAT_TTL_MS = 60_000;
