/**
 * Centralized Reliability & Timing Configuration
 *
 * All timing constants that govern agent liveness detection and daemon health.
 * These values are shared across the CLI (`get-next-task`, `daemon-start`),
 * the backend (Convex mutations/cron), and the frontend (display logic).
 *
 * ## Sections
 *
 * 1. **Agent Heartbeat** — `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TTL_MS`
 *    Controls how often the CLI pings the backend and how long a participant
 *    is considered reachable. TTL must be > interval to tolerate missed beats.
 *
 * 2. **Daemon Heartbeat** — `DAEMON_HEARTBEAT_INTERVAL_MS`, `DAEMON_HEARTBEAT_TTL_MS`
 *    Same pattern as agent heartbeat but for the daemon process itself.
 *    TTL must be > interval to tolerate missed beats.
 *
 * ## Key Relationships
 *
 * - `HEARTBEAT_TTL_MS` > `HEARTBEAT_INTERVAL_MS` (currently allows 2 missed beats)
 * - `DAEMON_HEARTBEAT_TTL_MS` > `DAEMON_HEARTBEAT_INTERVAL_MS` (allows 3 missed beats)
 *
 * ## Warning
 *
 * Changing these values affects system behavior across the CLI, daemon, and
 * backend cron jobs. Test timing changes end-to-end before deploying.
 */

/** How often the CLI sends a heartbeat to refresh readyUntil (ms). */
export const HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long a participant is considered reachable after the last heartbeat (ms).
 *  Must be > HEARTBEAT_INTERVAL_MS to tolerate missed beats. Allows 2 missed beats. */
export const HEARTBEAT_TTL_MS = 90_000; // 90s (Plan 026: increased from 60s)

/**
 * How long a lifecycle heartbeat can be absent before a WORKING agent is marked dead.
 *
 * Agents in `working` state are actively processing AI tasks (reading files, reasoning,
 * calling tools). These activities can take minutes between CLI command invocations that
 * trigger heartbeats. A much longer TTL prevents false-positive "dead" classification
 * while the agent is genuinely working.
 *
 * For `ready` state the shorter HEARTBEAT_TTL_MS applies, since a ready agent should
 * be in `get-next-task` which heartbeats every 30s.
 */
export const LIFECYCLE_WORKING_HEARTBEAT_TTL_MS = 600_000; // 10 min

// ─── Active Agent Heartbeat (Daemon-Side) ────────────────────────────────────

/** How often the daemon checks PID liveness and extends activeUntil (ms).
 *  Runs alongside the daemon heartbeat but targets active agent participants. */
export const ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long an active agent is considered alive after the last daemon heartbeat (ms).
 *  Must be > ACTIVE_AGENT_HEARTBEAT_INTERVAL_MS to tolerate missed beats. */
export const ACTIVE_AGENT_HEARTBEAT_TTL_MS = 90_000; // 90s

// ─── Grace Period ────────────────────────────────────────────────────────────

/** Grace period before recovering an acknowledged task (ms).
 *  If a task was acknowledged less than this long ago, another agent may still
 *  be working on it. The backend returns a `grace_period` response instead of
 *  handing the task to a new agent. */
export const RECOVERY_GRACE_PERIOD_MS = 60_000; // 1 min

// ─── Two-Phase Cleanup Grace Period ──────────────────────────────────────────

/** Grace period before a stale participant is actually deleted (ms).
 *  When the cleanup cron detects a stale agent, it marks it as `planned_cleanup`
 *  with a deadline of `now + CLEANUP_GRACE_PERIOD_MS`. If a heartbeat arrives
 *  before the deadline, the participant is restored to `waiting`. Only after the
 *  deadline passes is the participant deleted on the next cron run.
 *  Must be > HEARTBEAT_INTERVAL_MS (30s) to allow at least one heartbeat cycle. */
export const CLEANUP_GRACE_PERIOD_MS = 60_000; // 1 min

// ─── Daemon Heartbeat ────────────────────────────────────────────────────────

/** How often the daemon sends a heartbeat to refresh lastSeenAt (ms). */
export const DAEMON_HEARTBEAT_INTERVAL_MS = 30_000; // 30s

/** How long a daemon is considered alive after the last heartbeat (ms).
 *  Must be > DAEMON_HEARTBEAT_INTERVAL_MS to tolerate missed beats. Allows 3 missed beats. */
export const DAEMON_HEARTBEAT_TTL_MS = 120_000; // 2 min (Plan 026: increased from 90s)
