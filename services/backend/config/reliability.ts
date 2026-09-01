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

/** Max wait for harnessSessionId after spawn before kill+restart (native harnesses). */
export const HARNESS_SESSION_READY_TIMEOUT_MS = 5_000;

/** Reconcile pending native task delivery when agent is ready (ms). */
export const NATIVE_DELIVERY_RECONCILE_MS = 10_000;

// ─── Daemon Heartbeat ────────────────────────────────────────────────────────

/** How often the daemon sends a heartbeat to refresh lastSeenAt (ms). */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 5 * 60_000; // 5 min

/** How long before a daemon is considered offline if no heartbeat received (ms).
 *  Must exceed DAEMON_LIVENESS_WRITE_INTERVAL_MS + DAEMON_HEARTBEAT_INTERVAL_MS
 *  so throttled lastSeenAt writes never expire between heartbeats. Set to 6× heartbeat. */
export const DAEMON_HEARTBEAT_TTL_MS = 6 * DAEMON_HEARTBEAT_INTERVAL_MS; // 30 min

// ─── Agent Request Deadline ──────────────────────────────────────────────────

/** How long an agent.requestStart / agent.requestStop event is considered valid (ms).
 *  After this deadline, daemons should ignore the request to avoid late-arriving
 *  starts/stops acting on stale intent. Set to 2 minutes. */
export const AGENT_REQUEST_DEADLINE_MS = 120_000; // 2 minutes

/** How long a durable agent stop command remains inflight before expiry. */
export const AGENT_STOP_REQUEST_DEADLINE_MS = 10_000; // 10 seconds

export const MACHINE_COMMAND_CLAIM_LEASE_MS = 60_000;
export const MACHINE_COMMAND_LEASE_RENEWAL_INTERVAL_MS = 20_000;
export const MACHINE_COMMAND_DAEMON_ROUTINE_TTL_MS = 5 * 60_000;
export const MACHINE_COMMAND_LOCAL_ACTION_TTL_MS = 60_000;

// ─── Observed Chatroom Sync ───────────────────────────────────────────────────

/** How long a chatroom remains marked as "observed" before TTL expires (ms).
 * If frontend stops sending heartbeats within this window, the chatroom drops off
 * the daemon workspace watch list (recency window for listRecentlyObservedWorkspacesForMachine).
 * The backend schedules a one-shot expiry nudge so daemons reconcile without polling.
 * Does not gate handoff-to-user git refresh. Set to 60s. */
export const OBSERVATION_TTL_MS = 60_000;

/** Minimum interval between `lastObservedAt` patches for regular (non-refresh) heartbeats (ms).
 *  Dedupes burst writes from mount + visibility refresh + interval firing close together.
 *  Must be < OBSERVATION_TTL_MS. Set to 25s. */
export const OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS = 25_000;

/** How often frontend sends a heartbeat while chatroom view is visible (ms).
 *  Frontend sends this heartbeat to keep chatrooms marked as observed.
 *  Set to 45s (within 60s OBSERVATION_TTL_MS with margin). */
export const FRONTEND_OBSERVATION_HEARTBEAT_MS = 45_000;

// ─── Participant Lifecycle Heartbeat ─────────────────────────────────────────

/** Minimum interval between participant `lastSeenAt` writes (ms).
 *  CLI preAction fires on every command; throttling reduces presence subscription churn.
 *  Set to 30s to match agent presence UI refresh cadence. */
export const PARTICIPANT_HEARTBEAT_MIN_INTERVAL_MS = 30_000;

// ─── Daemon Liveness Write Throttle ──────────────────────────────────────────

/** Minimum interval between `chatroom_machineLiveness.lastSeenAt` patches (ms).
 *  Daemon heartbeats every 5min but only writes liveness when this interval elapses,
 *  reducing getDaemonStatus subscription invalidations. Must be < DAEMON_HEARTBEAT_TTL_MS.
 *
 *  Set to 90s: with 5min heartbeats every heartbeat writes liveness (interval < heartbeat).
 *  The only cost is "last seen" display freshness, which still refreshes well within
 *  the 30min liveness TTL. */
export const DAEMON_LIVENESS_WRITE_INTERVAL_MS = 90_000;

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

/** Max exits allowed in CIRCUIT_WINDOW_MS before circuit trips. */
export const CIRCUIT_BREAKER_MAX_EXITS = 3;
export const AGENT_STOP_EXPIRY_LEASE_GRACE_MS = 30_000;
export const AGENT_STOP_TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Per-target budget for scoped stop fan-out before force-kill (ms). */
export const SCOPE_TARGET_STOP_TIMEOUT_MS = 10_000;

/** Rolling window for counting exits. Circuit trips if agent exits ≥ MAX_EXITS in this window. */
export const CIRCUIT_WINDOW_MS = 300_000; // 5 minutes

/** Cool-down period after circuit trips (OPEN state) before allowing HALF-OPEN attempt. */
export const CIRCUIT_COOLDOWN_MS = 60_000; // 1 minute

// ─── Connection Close Requests ───────────────────────────────────────────────

/** TTL for a connection close request (ms). After this, the cron removes the row.
 *  Long enough that a temporarily-offline loop still sees its close request when it
 *  reconnects, short enough to keep the table small. */
export const CONNECTION_CLOSE_REQUEST_TTL_MS = 10 * 60_000; // 10 min

// ─── Enhancer ────────────────────────────────────────────────────────────────

/** Max enhancer attempts before terminal failure (no draft fallback). */
export const ENHANCER_MAX_ATTEMPTS = 3;

/** Base delay for exponential backoff between enhancer retries (ms). */
export const ENHANCER_RETRY_BASE_MS = 2_000;

/** Retain terminal enhancer jobs before cron purge (ms). */
export const ENHANCER_TERMINAL_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** CLI poll interval while waiting for enhancer job (ms). */
export const ENHANCER_CLI_POLL_INTERVAL_MS = 1_000;
