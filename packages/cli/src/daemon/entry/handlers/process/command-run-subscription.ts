// fallow-ignore-file code-duplication
/**
 * Reactive subscription for imperative process-host commands.
 *
 * Isolated from the multiplexed getCommandEvents stream so UI run/stop
 * requests are not blocked by agent lifecycle or git events. The backend's
 * chatroom_commandRunsV2 rows are the source of truth: pending rows need a
 * spawn, running rows with terminationReason === 'user-stop' need a kill.
 *
 * The subscription lifecycle (start/stop handle, error callback) deliberately
 * mirrors the git and log-observer subscription modules.
 */

import type { FunctionReturnType } from 'convex/server';
import { Effect, Runtime } from 'effect';

import { api } from '../../../../api.js';
import {
  DaemonSessionService,
  type DaemonSessionServiceShape,
} from '../../../../commands/machine/daemon-start/daemon-services.js';
import type { SessionId } from '../../../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../../../commands/machine/daemon-start/utils.js';
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

/** Process actionable command runs from subscription or inbound nudge. */
// fallow-ignore-next-line unused-export
export function processActionableCommandRuns(
  session: DaemonSessionServiceShape,
  effectContext: Runtime.Runtime<DaemonSessionService>,
  result: ActionableCommandRuns | null | undefined
): void {
  if (!result) return;
  for (const run of result.pendingRuns ?? []) {
    dispatchPendingRun(run, session, effectContext);
  }
  for (const run of result.stopRequestedRuns ?? []) {
    dispatchStopRequest(run, session, effectContext);
  }
}

/** Query backend and process all actionable runs (for v2 inbound nudge). */
export async function drainActionableCommandRuns(
  session: DaemonSessionServiceShape,
  effectContext: Runtime.Runtime<DaemonSessionService>
): Promise<void> {
  const result = await session.backend.query(api.daemon.commands.listActionableCommandRuns, {
    sessionId: session.sessionId as SessionId,
    machineId: session.machineId,
  });
  processActionableCommandRuns(session, effectContext, result as ActionableCommandRuns);
}

/**
 * Subscribe to runs the daemon must act on (pending spawns + user-requested stops).
 * WS removed in U13 — v2 `command-run` subscriber nudges `drainActionableCommandRuns`.
 */
export function startCommandRunSubscription(): { stop: () => void } {
  return { stop: () => {} };
}

/** Test helper — reset in-memory dedup state between test cases. */
// fallow-ignore-next-line unused-export
export function _resetCommandRunSubscriptionStateForTest(): void {
  dispatchedPending.clear();
  dispatchedStop.clear();
}
