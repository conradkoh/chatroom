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

  const poll = async () => {
    if (stopped) return;
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
    } catch (err) {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Log-observer poll failed: ${getErrorMessage(err)}`
      );
    }
  };

  void poll();
  const handle = setInterval(() => {
    void poll();
  }, OUTPUT_FLUSH_INTERVAL_MS);
  handle.unref?.();

  return {
    stop: () => {
      stopped = true;
      clearInterval(handle);
      observedRunIds.clear();
      pendingFullSyncRunIds.clear();
    },
  };
}
