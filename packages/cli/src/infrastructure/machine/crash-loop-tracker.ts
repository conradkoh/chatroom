/**
 * CrashLoopTracker — detects rapid restart loops per (chatroomId, role).
 *
 * Uses a sliding window with progressive backoff: records timestamps of recent
 * restarts and checks whether the agent should be allowed to restart based on
 * the backoff schedule. If not, the caller should schedule a retry.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum number of restarts within WINDOW_MS before the loop is halted.
 * Expanded from 3 to 10 to accommodate progressive backoff.
 */
export const CRASH_LOOP_MAX_RESTARTS = 10;

/**
 * Sliding window duration in milliseconds.
 * Expanded to accommodate 10 restarts with backoff (~9.5 minutes total).
 */
export const CRASH_LOOP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Backoff intervals in milliseconds.
 * - Attempt 1: immediate (0ms)
 * - Attempt 2: 30 seconds
 * - Attempts 3-10: 1 minute each (sustained backoff)
 */
export const BACKOFF_INTERVALS: readonly number[] = [
  0,      // Attempt 1: immediate
  30000,  // Attempt 2: 30 seconds
  60000,  // Attempt 3-10: 1 minute each
];

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Result of a restart-allowance check.
 */
export interface CrashLoopCheckResult {
  /** Whether the restart is allowed immediately. */
  allowed: boolean;
  /** Total number of restart attempts (including blocked). */
  restartCount: number;
  /** The window duration used for the check. */
  windowMs: number;
  /** When the next restart is allowed (ms since epoch). Undefined if allowed immediately. */
  nextAllowedAt?: number;
  /** How long to wait before retrying (0 if immediate). Undefined if allowed immediately. */
  waitMs?: number;
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
   * and schedule a retry after `waitMs` instead.
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

    // Count of restarts already recorded (successful ones)
    const restartCount = recent.length;

    // Check if we've exceeded max restarts
    if (restartCount >= CRASH_LOOP_MAX_RESTARTS) {
      // Note: we don't record the blocked attempt in history
      return {
        allowed: false,
        restartCount: restartCount + 1, // Count the blocked attempt
        windowMs: CRASH_LOOP_WINDOW_MS,
      };
    }

    // Calculate the expected backoff interval based on the next attempt number
    // Next attempt = restartCount + 1
    const nextAttemptNumber = restartCount + 1;
    const backoffIndex = Math.min(
      nextAttemptNumber - 1, // 1st attempt -> index 0, 2nd -> index 1, etc.
      BACKOFF_INTERVALS.length - 1
    );
    const expectedInterval = BACKOFF_INTERVALS[backoffIndex];

    // Check if enough time has passed since the last successful restart
    const lastRestart = recent[recent.length - 1]; // Most recent successful restart
    if (lastRestart !== undefined && expectedInterval > 0) {
      const timeSinceLastRestart = now - lastRestart;

      if (timeSinceLastRestart < expectedInterval) {
        // Not enough time has passed — calculate wait time
        // Note: we don't record the blocked attempt in history
        const nextAllowedAt = lastRestart + expectedInterval;
        const waitMs = nextAllowedAt - now;

        return {
          allowed: false,
          restartCount: restartCount + 1, // Count the blocked attempt
          windowMs: CRASH_LOOP_WINDOW_MS,
          nextAllowedAt,
          waitMs,
        };
      }
    }

    // Restart is allowed — record the successful restart
    recent.push(now);
    this.history.set(key, recent);

    return {
      allowed: true,
      restartCount: restartCount + 1,
      windowMs: CRASH_LOOP_WINDOW_MS,
    };
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
   * Returns the number of successful restarts recorded in the current window for this agent.
   * Does NOT record a new restart — use for inspection only.
   */
  getCount(chatroomId: string, role: string, now: number = Date.now()): number {
    const key = `${chatroomId}:${role.toLowerCase()}`;
    const windowStart = now - CRASH_LOOP_WINDOW_MS;
    const raw = this.history.get(key) ?? [];
    return raw.filter((ts) => ts >= windowStart).length;
  }
}
