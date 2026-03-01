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
 * An agent is stuck if they have an acknowledged task AND either:
 *   - Have never been seen (lastSeenAt == null), OR
 *   - Have not produced a token in over STUCK_TOKEN_THRESHOLD_MS
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

// ─── Stuck Agent Detection ───────────────────────────────────────────────────

/** If an agent has an acknowledged task AND has not produced a token in over this
 *  threshold, it is considered stuck. Set to 5 minutes — long enough to tolerate
 *  slow LLM responses, short enough to detect genuinely hung agents. */
export const STUCK_TOKEN_THRESHOLD_MS = 300_000; // 5 min

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

// ─── Agent Request Deadline ──────────────────────────────────────────────────

/** How long an agent.requestStart / agent.requestStop event is considered valid (ms).
 *  After this deadline, daemons should ignore the request to avoid late-arriving
 *  starts/stops acting on stale intent. Set to 2 minutes. */
export const AGENT_REQUEST_DEADLINE_MS = 120_000; // 2 minutes

// ─── ensureAgentHandler Fallback Delay ──────────────────────────────────────

/**
 * Delay (ms) for the ensureAgentHandler backend fallback.
 * Set to 5 minutes — the daemon's event-driven path handles restarts within
 * 2 minutes (AGENT_REQUEST_DEADLINE_MS). This fallback only fires when the
 * daemon is offline.
 */
export const ENSURE_AGENT_FALLBACK_DELAY_MS = 300_000; // 5 minutes
