/**
 * Git Polling Loop — fast polling loop for on-demand workspace git requests.
 *
 * Runs every `GIT_POLLING_INTERVAL_MS` (5 seconds).
 * Responsibilities (to be implemented in later phases):
 *   - Process pending `full_diff` requests from the backend
 *   - Process pending `commit_detail` requests from the backend
 *   - Process pending `more_commits` requests from the backend
 *
 * The heartbeat loop (every 30s) is responsible for pushing incremental
 * git state (branch, isDirty, diffStat, recentCommits) when state changes.
 * This fast loop is only for on-demand requests that require low latency.
 */

import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';

/** How often the git polling loop checks for pending requests (ms). */
export const GIT_POLLING_INTERVAL_MS = 5_000; // 5 seconds

/** Handle returned by `startGitPollingLoop` to stop the loop. */
export interface GitPollingHandle {
  /** Stop the polling loop and clear the timer. */
  stop: () => void;
}

/**
 * Start the fast git polling loop.
 *
 * Called once during daemon startup, after the heartbeat loop is running.
 * Returns a handle with a `stop()` method for clean shutdown.
 *
 * @param ctx - Daemon context (session, machineId, deps)
 */
export function startGitPollingLoop(ctx: DaemonContext): GitPollingHandle {
  const timer = setInterval(() => {
    runPollingTick(ctx).catch((err: Error) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Git polling tick failed: ${err.message}`
      );
    });
  }, GIT_POLLING_INTERVAL_MS);

  // Don't prevent process exit during shutdown
  timer.unref();

  console.log(
    `[${formatTimestamp()}] 🔀 Git polling loop started (interval: ${GIT_POLLING_INTERVAL_MS}ms)`
  );

  return {
    stop: () => {
      clearInterval(timer);
      console.log(`[${formatTimestamp()}] 🔀 Git polling loop stopped`);
    },
  };
}

/**
 * A single tick of the polling loop.
 *
 * Currently a no-op placeholder — request processing will be added in
 * subsequent phases when the backend workspace mutations are available.
 */
async function runPollingTick(_ctx: DaemonContext): Promise<void> {
  // Phase 2+: query backend for pending diff/commit/more-commits requests
  // and process them here.
}
