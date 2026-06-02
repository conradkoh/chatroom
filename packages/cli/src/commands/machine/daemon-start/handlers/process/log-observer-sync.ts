/**
 * Tracks which command runs have active log observers (webapp UI open).
 * Daemon polls Convex and only syncs tail output for observed runs.
 */

import { api } from '../../../../../api.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { DaemonContext, SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';
import { OUTPUT_FLUSH_INTERVAL_MS } from './state.js';

const observedRunIds = new Set<string>();
const pendingFullSyncRunIds = new Set<string>();

const ACTIVE_POLL_INTERVAL_MS = OUTPUT_FLUSH_INTERVAL_MS;
const IDLE_POLL_INTERVAL_MS = 15_000;
const IDLE_SKIP_AFTER_CONSECUTIVE = 3;

export function isRunLogObserved(runId: string): boolean {
  return observedRunIds.has(runId);
}

export function consumePendingFullSync(runId: string): boolean {
  if (!pendingFullSyncRunIds.has(runId)) return false;
  pendingFullSyncRunIds.delete(runId);
  return true;
}

export function startLogObserverPoll(ctx: DaemonContext): { stop: () => void } {
  let stopped = false;
  let consecutiveIdlePolls = 0;
  let pollInFlight = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    if (timeoutHandle) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(() => {
      void poll();
    }, delayMs);
    timeoutHandle.unref?.();
  };

  const poll = async () => {
    if (stopped || pollInFlight) return;

    const hasLocalObservers = observedRunIds.size > 0;
    if (
      !hasLocalObservers &&
      consecutiveIdlePolls >= IDLE_SKIP_AFTER_CONSECUTIVE
    ) {
      scheduleNext(IDLE_POLL_INTERVAL_MS);
      return;
    }

    pollInFlight = true;
    try {
      const runs = (await ctx.deps.backend.query(api.commands.listRunsWithLogObservers, {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
      })) as Array<{ _id: string; pendingFullOutputSync: boolean }>;

      observedRunIds.clear();
      pendingFullSyncRunIds.clear();
      for (const run of runs) {
        observedRunIds.add(run._id);
        if (run.pendingFullOutputSync) {
          pendingFullSyncRunIds.add(run._id);
        }
      }

      const isActive = runs.length > 0 || hasLocalObservers;
      if (isActive) {
        consecutiveIdlePolls = 0;
        scheduleNext(ACTIVE_POLL_INTERVAL_MS);
      } else {
        consecutiveIdlePolls++;
        scheduleNext(
          consecutiveIdlePolls >= IDLE_SKIP_AFTER_CONSECUTIVE
            ? IDLE_POLL_INTERVAL_MS
            : ACTIVE_POLL_INTERVAL_MS
        );
      }
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Log-observer poll failed: ${getErrorMessage(err)}`
      );
      scheduleNext(ACTIVE_POLL_INTERVAL_MS);
    } finally {
      pollInFlight = false;
    }
  };

  void poll();

  return {
    stop: () => {
      stopped = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      observedRunIds.clear();
      pendingFullSyncRunIds.clear();
    },
  };
}
