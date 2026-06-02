/**
 * Reactive subscription to command runs with active log observers.
 *
 * Populates local observer sets so tail flushes only run for watched runs,
 * without polling on a fixed interval.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';

import { api } from '../../../../../api.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { DaemonContext } from '../../types.js';
import { formatTimestamp } from '../../utils.js';

type ObservedRuns = FunctionReturnType<
  typeof api.daemon.commands.listRunsWithLogObservers
>;

const observedRunIds = new Set<string>();
const pendingFullSyncRunIds = new Set<string>();

function applyObservedRuns(runs: ObservedRuns): void {
  observedRunIds.clear();
  pendingFullSyncRunIds.clear();
  for (const run of runs) {
    observedRunIds.add(run._id);
    if (run.pendingFullOutputSync) {
      pendingFullSyncRunIds.add(run._id);
    }
  }
}

export function isRunLogObserved(runId: string): boolean {
  return observedRunIds.has(runId);
}

export function consumePendingFullSync(runId: string): boolean {
  if (!pendingFullSyncRunIds.has(runId)) return false;
  pendingFullSyncRunIds.delete(runId);
  return true;
}

/** Subscribe to runs needing log tail sync; returns stop handle. */
export function startLogObserverSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): { stop: () => void } {
  const queryArgs = {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
  };

  let stopped = false;

  const unsubscribe = wsClient.onUpdate(
    api.daemon.commands.listRunsWithLogObservers,
    queryArgs,
    (runs) => {
      if (stopped) return;
      applyObservedRuns(runs ?? []);
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Log-observer subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  console.log(`[${formatTimestamp()}] 📜 Log-observer subscription started`);

  return {
    stop: () => {
      stopped = true;
      unsubscribe();
      observedRunIds.clear();
      pendingFullSyncRunIds.clear();
      console.log(`[${formatTimestamp()}] 📜 Log-observer subscription stopped`);
    },
  };
}
