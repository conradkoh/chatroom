/**
 * Centralized Reliability & Timing Configuration
 *
 * All timing constants that govern agent liveness detection and daemon health.
 * These values are shared across the CLI (`get-next-task`, `daemon-start`),
 * the backend (Convex mutations/cron), and the frontend (display logic).
 *
 * ## Agent Presence Model
 *
 * A single threshold governs agent online/offline status:
 * - `PRESENCE_THRESHOLD_MS` — agent is "online" if seen within this window (10 min)
 *
 * An online agent is considered "working" if `lastSeenAction !== 'get-next-task:started'`.
 *
 * ## Daemon Heartbeat
 *
 * The daemon uses its own separate heartbeat constants (`DAEMON_HEARTBEAT_*`).
 * These are intentionally independent of agent presence tracking.
 *
 * ## Warning
 *
 * Changing these values affects system behavior across the CLI, daemon, and
 * backend cron jobs. Test timing changes end-to-end before deploying.
 */

// ─── Agent Presence ──────────────────────────────────────────────────────────

/** How long an agent is considered online after the last action/heartbeat (ms).
 *  Used in both the backend (participant queries) and frontend (AgentPanel display).
 *  Must be kept in sync with the frontend PRESENCE_THRESHOLD_MS constant. */
export const PRESENCE_THRESHOLD_MS = 600_000; // 10 min

// ─── Grace Period ────────────────────────────────────────────────────────────

/** Grace period before recovering an acknowledged task (ms).
 *  If a task was acknowledged less than this long ago, another agent may still
 *  be working on it. The backend returns a `grace_period` response instead of
 *  handing the task to a new agent. */
export const RECOVERY_GRACE_PERIOD_MS = 60_000; // 1 min

// ─── Daemon Heartbeat ────────────────────────────────────────────────────────

/** How often the daemon sends a heartbeat to refresh lastSeenAt (ms). */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long a daemon is considered alive after the last heartbeat (ms).
 *  Must be > DAEMON_HEARTBEAT_INTERVAL_MS to tolerate missed beats. Allows 3 missed beats. */
export const DAEMON_HEARTBEAT_TTL_MS = 120_000; // 2 min (Plan 026: increased from 90s)
