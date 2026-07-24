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

// ─── Observed Chatroom Sync ───────────────────────────────────────────────────

/** How long a chatroom remains marked as "observed" before TTL expires (ms).
 *  If frontend stops sending heartbeats within this window, daemon stops syncing.
 *  Set to 60s. */
export const OBSERVATION_TTL_MS = 60_000;

/** How often the daemon performs a full (non-slim) git state push per workspace.
 *  Slim pushes run every safety poll; this ensures non-slim fields (diffStat,
 *  commitsAhead, remotes, recentCommits) refresh at least this often.
 *  allPullRequests are fetched on demand via requestAllPullRequests.
 *  Set to 5 minutes. */
export const OBSERVED_FULL_PUSH_INTERVAL_MS = 5 * 60_000;

/** Safety poll interval for observed chatrooms (ms).
 *  Daemon additionally polls observed chatrooms periodically as a safety net
 *  in case frontend heartbeat stops unexpectedly. Set to 30s. */
export const OBSERVED_SAFETY_POLL_MS = 30_000;

/**
 * Slow reconcile interval for the observed-sync subscription (ms).
 * Convex `onUpdate` handles reactive invalidation; this timer is a fallback for
 * TTL drift when observation rows expire without a reactive callback. Set to 15 min.
 */
export const OBSERVED_SYNC_RECONCILE_MS = 15 * 60_000;

/** Minimum interval between `lastObservedAt` patches for regular (non-refresh) heartbeats (ms).
 *  Dedupes burst writes from mount + visibility refresh + interval firing close together.
 *  Must be < OBSERVATION_TTL_MS. Set to 25s. */
export const OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS = 25_000;

/** How often frontend sends a heartbeat while chatroom view is visible (ms).
 *  Frontend sends this heartbeat to keep chatrooms marked as observed.
 *  Set to 30s. */
export const FRONTEND_OBSERVATION_HEARTBEAT_MS = 30_000;

/** Workspaces are included in daemon sync lists only if observed within this window (ms). */
export const WORKSPACE_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Daemon reconcile interval for workspace-list subscription TTL drift (ms). */
export const WORKSPACE_LIST_RECONCILE_MS = 60 * 60 * 1000; // 1 hour

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

/** Per-attempt timeout while job is `running` before recording failure (ms). */
export const ENHANCER_ATTEMPT_TIMEOUT_MS = 120_000;

/** Retain terminal enhancer jobs before cron purge (ms). */
export const ENHANCER_TERMINAL_JOB_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** CLI poll interval while waiting for enhancer job (ms). */
export const ENHANCER_CLI_POLL_INTERVAL_MS = 1_000;
