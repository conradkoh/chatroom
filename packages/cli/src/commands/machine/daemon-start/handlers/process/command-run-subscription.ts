// fallow-ignore-file code-duplication
/**
 * Reactive subscription for imperative process-host commands.
 *
 * Isolated from the multiplexed getCommandEvents stream so UI run/stop
 * requests are not blocked by agent lifecycle or git events. The backend's
 * chatroom_commandRuns rows are the source of truth: pending rows need a
 * spawn, running rows with terminationReason === 'user-stop' need a kill.
 *
 * The subscription lifecycle (start/stop handle, error callback) deliberately
 * mirrors the git and log-observer subscription modules.
 */

import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';
import { Effect, Runtime } from 'effect';

import { api } from '../../../../../api.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../../daemon-services.js';
import type { SessionId } from '../../types.js';
import { formatTimestamp } from '../../utils.js';
import { onCommandRunEffect, onCommandStopEffect } from '../command-runner.js';

type ActionableCommandRuns = FunctionReturnType<
  typeof api.daemon.commands.listActionableCommandRuns
>;

const dispatchedPending = new Set<string>();
const dispatchedStop = new Set<string>();

function dispatchPendingRun(
  run: ActionableCommandRuns['pendingRuns'][number],
  session: DaemonSessionServiceShape,
  effectContext: Runtime.Runtime<DaemonSessionService>
): void {
  const id = run._id.toString();
  if (dispatchedPending.has(id)) return;
  dispatchedPending.add(id);
  console.log(`[${formatTimestamp()}] ⚡ Imperative command.run: ${run.commandName} (${id})`);
  Runtime.runFork(effectContext)(
    onCommandRunEffect({
      workingDir: run.workingDir,
      commandName: run.commandName,
      script: run.script,
      runId: run._id,
    }).pipe(Effect.provideService(DaemonSessionService, session))
  );
}

function dispatchStopRequest(
  run: ActionableCommandRuns['stopRequestedRuns'][number],
  session: DaemonSessionServiceShape,
  effectContext: Runtime.Runtime<DaemonSessionService>
): void {
  const id = run._id.toString();
  if (dispatchedStop.has(id)) return;
  dispatchedStop.add(id);
  console.log(`[${formatTimestamp()}] ⚡ Imperative command.stop: (${id})`);
  Runtime.runFork(effectContext)(
    onCommandStopEffect({ runId: run._id }).pipe(
      Effect.provideService(DaemonSessionService, session)
    )
  );
}

/**
 * Subscribe to runs the daemon must act on (pending spawns + user-requested
 * stops). Handlers are forked via the supplied Effect runtime so a slow agent
 * or git handler in the main stream can never block command dispatch.
 */
export function startCommandRunSubscription(
  session: DaemonSessionServiceShape,
  wsClient: ConvexClient,
  effectContext: Runtime.Runtime<DaemonSessionService>
): { stop: () => void } {
  let stopped = false;

  const unsubscribe = wsClient.onUpdate(
    api.daemon.commands.listActionableCommandRuns,
    { sessionId: session.sessionId as SessionId, machineId: session.machineId },
    // fallow-ignore-next-line complexity
    (result: ActionableCommandRuns | null | undefined) => {
      if (stopped || !result) return;
      for (const run of result.pendingRuns ?? []) {
        dispatchPendingRun(run, session, effectContext);
      }
      for (const run of result.stopRequestedRuns ?? []) {
        dispatchStopRequest(run, session, effectContext);
      }
    },
    (err: unknown) =>
      console.warn(
        `[${formatTimestamp()}] ⚠️ Command-run subscription error: ${getErrorMessage(err)}`
      )
  );

  console.log(`[${formatTimestamp()}] ⚡ Command-run subscription started`);

  return {
    stop: () => {
      stopped = true;
      unsubscribe();
      console.log(`[${formatTimestamp()}] ⚡ Command-run subscription stopped`);
    },
  };
}

/** Test helper — reset in-memory dedup state between test cases. */
// fallow-ignore-next-line unused-export
export function _resetCommandRunSubscriptionStateForTest(): void {
  dispatchedPending.clear();
  dispatchedStop.clear();
}
