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
import type { SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';

type ObservedRuns = FunctionReturnType<typeof api.daemon.commands.listRunsWithLogObservers>;

const observedRunIds = new Set<string>();
const pendingFullSyncRunIds = new Set<string>();

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) {
    if (!b.has(id)) return false;
  }
  return true;
}

function formatRunIdShort(runId: string): string {
  return runId.length > 8 ? `${runId.slice(0, 8)}…` : runId;
}

function logObserverSetChangeIfNeeded(runs: ObservedRuns): void {
  const nextObserved = new Set<string>();
  const nextPending = new Set<string>();
  for (const run of runs) {
    nextObserved.add(run._id);
    if (run.pendingFullOutputSync) {
      nextPending.add(run._id);
    }
  }

  if (setsEqual(observedRunIds, nextObserved) && setsEqual(pendingFullSyncRunIds, nextPending)) {
    return;
  }

  const runSummaries = [...nextObserved].map(formatRunIdShort).join(', ') || 'none';
  console.log(
    `[${formatTimestamp()}] 📜 Log observers updated: ${nextObserved.size} run(s) [${runSummaries}] pendingFull=${nextPending.size}`
  );
}

function applyObservedRuns(runs: ObservedRuns): void {
  logObserverSetChangeIfNeeded(runs);
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

/** Minimal session identity needed by startLogObserverSubscription. */
export interface LogObserverSession {
  readonly sessionId: SessionId;
  readonly machineId: string;
}

/** Subscribe to runs needing log tail sync; returns stop handle. */
export function startLogObserverSubscription(
  session: LogObserverSession,
  wsClient: ConvexClient
): { stop: () => void } {
  const queryArgs = {
    sessionId: session.sessionId,
    machineId: session.machineId,
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
