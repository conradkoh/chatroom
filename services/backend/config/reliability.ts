/**
 * Centralized Reliability & Timing Configuration
 *
 * All timing constants that govern agent liveness detection and daemon health.
 * These values are shared across the CLI (`get-next-task`, `daemon-start`),
 * the backend (Convex mutations/cron), and the frontend (display logic).
 *
 * ## Agent Presence Model
 *
 * All agents are always considered "present" (no time-based filtering).
 * An agent is considered "working" if `lastSeenAction !== 'get-next-task:started'`.
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

// ─── Grace Period ────────────────────────────────────────────────────────────

/** Grace period before recovering an acknowledged task (ms).
 *  If a task was acknowledged less than this long ago, another agent may still
 *  be working on it. The backend returns a `grace_period` response instead of
 *  handing the task to a new agent. */
export const RECOVERY_GRACE_PERIOD_MS = 60_000; // 1 min

// ─── Daemon Heartbeat ────────────────────────────────────────────────────────

/** How often the daemon sends a heartbeat to refresh lastSeenAt (ms). */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long before a daemon is considered offline if no heartbeat received (ms).
 *  Set to 3× the heartbeat interval (90s). */
export const DAEMON_HEARTBEAT_TTL_MS = 90_000; // 90s

// ─── Agent Request Deadline ──────────────────────────────────────────────────

/** How long an agent.requestStart / agent.requestStop event is considered valid (ms).
 *  After this deadline, daemons should ignore the request to avoid late-arriving
 *  starts/stops acting on stale intent. Set to 2 minutes. */
export const AGENT_REQUEST_DEADLINE_MS = 120_000; // 2 minutes

// ─── Observed Chatroom Sync ───────────────────────────────────────────────────

/** How long a chatroom remains marked as "observed" before TTL expires (ms).
 *  If frontend stops sending heartbeats within this window, daemon stops syncing.
 *  Set to 60s. */
export const OBSERVATION_TTL_MS = 60_000;

/** Safety poll interval for observed chatrooms (ms).
 *  Daemon additionally polls observed chatrooms periodically as a safety net
 *  in case frontend heartbeat stops unexpectedly. Set to 30s. */
export const OBSERVED_SAFETY_POLL_MS = 30_000;

/** How often frontend sends a heartbeat while chatroom view is visible (ms).
 *  Frontend sends this heartbeat to keep chatrooms marked as observed.
 *  Set to 30s. */
export const FRONTEND_OBSERVATION_HEARTBEAT_MS = 30_000;

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

/** Max exits allowed in CIRCUIT_WINDOW_MS before circuit trips. */
export const CIRCUIT_BREAKER_MAX_EXITS = 3;

/** Rolling window for counting exits. Circuit trips if agent exits ≥ MAX_EXITS in this window. */
export const CIRCUIT_WINDOW_MS = 300_000; // 5 minutes

/** Cool-down period after circuit trips (OPEN state) before allowing HALF-OPEN attempt. */
export const CIRCUIT_COOLDOWN_MS = 60_000; // 1 minute
