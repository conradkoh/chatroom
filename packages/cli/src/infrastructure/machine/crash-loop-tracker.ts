/**
 * CrashLoopTracker — detects rapid restart loops per (chatroomId, role).
 *
 * Uses a sliding window: records timestamps of recent restarts and checks
 * whether MAX_RESTARTS have occurred within WINDOW_MS. If so, the agent
 * is considered to be in a crash loop and the caller should stop restarting.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum number of restarts within WINDOW_MS before the loop is halted. */
export const CRASH_LOOP_MAX_RESTARTS = 3;

/** Sliding window duration in milliseconds. */
export const CRASH_LOOP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Result of a restart-allowance check.
 */
export interface CrashLoopCheckResult {
  /** Whether the restart is allowed. */
  allowed: boolean;
  /** Number of restarts recorded in the current window (including this one if allowed). */
  restartCount: number;
  /** The window duration used for the check. */
  windowMs: number;
}

/**
 * Tracks restart timestamps per `${chatroomId}:${role}` key.
 * Exported for testing only — use the singleton instance in production.
 */
export class CrashLoopTracker {
  /** Map of agent key → sorted list of restart timestamps (oldest first). */
  private readonly history = new Map<string, number[]>();

  /**
   * Record a restart attempt and check whether the agent is in a crash loop.
   *
   * Call this BEFORE spawning. If the result is `allowed: false`, do not spawn
   * and emit an `agent.restartLimitReached` event instead.
   *
   * @param chatroomId - Chatroom identifier
   * @param role - Agent role (case-insensitive)
   * @param now - Current timestamp in ms (defaults to Date.now())
   */
  record(chatroomId: string, role: string, now: number = Date.now()): CrashLoopCheckResult {
    const key = `${chatroomId}:${role.toLowerCase()}`;
    const windowStart = now - CRASH_LOOP_WINDOW_MS;

    // Fetch existing history and prune entries outside the window
    const raw = this.history.get(key) ?? [];
    const recent = raw.filter((ts) => ts >= windowStart);

    // Add the current restart
    recent.push(now);
    this.history.set(key, recent);

    const restartCount = recent.length;
    const allowed = restartCount <= CRASH_LOOP_MAX_RESTARTS;

    return { allowed, restartCount, windowMs: CRASH_LOOP_WINDOW_MS };
  }

  /**
   * Clear the restart history for an agent.
   * Call when the agent is intentionally stopped (user.stop) to reset the window.
   */
  clear(chatroomId: string, role: string): void {
    const key = `${chatroomId}:${role.toLowerCase()}`;
    this.history.delete(key);
  }

  /**
   * Returns the number of restarts recorded in the current window for this agent.
   * Does NOT record a new restart — use for inspection only.
   */
  getCount(chatroomId: string, role: string, now: number = Date.now()): number {
    const key = `${chatroomId}:${role.toLowerCase()}`;
    const windowStart = now - CRASH_LOOP_WINDOW_MS;
    const raw = this.history.get(key) ?? [];
    return raw.filter((ts) => ts >= windowStart).length;
  }
}
