import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { Cause, Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../daemon/entry/daemon-services.js';
import { formatTimestamp } from '../../daemon/entry/daemon-utils.js';
import { shutdownAllCommandsEffect } from '../../daemon/entry/handlers/command-runner.js';

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

type ActiveAgent = ReturnType<DaemonAgentProcessManagerServiceShape['listActive']>[number];

const stopAgentFromSnapshot = (
  agentPm: DaemonAgentProcessManagerServiceShape,
  { chatroomId, role, slot }: ActiveAgent
): Effect.Effect<boolean> => {
  return Effect.try({
    try: () =>
      agentPm.stop({
        chatroomId,
        role,
        reason: 'daemon.shutdown',
        pid: slot.pid,
        workingDir: slot.workingDir,
      }),
    catch: (error) => error,
  }).pipe(
    Effect.flatMap((stopEffect) => stopEffect),
    Effect.map(({ success }) => success),
    Effect.tap((success) =>
      !success
        ? Effect.sync(() =>
            console.warn(`   ⚠️  Failed to stop ${role}@${chatroomId}: stop was not confirmed`)
          )
        : Effect.void
    ),
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        console.warn(`   ⚠️  Failed to stop ${role}@${chatroomId}: ${Cause.pretty(cause)}`);
        return false;
      })
    )
  );
};

const logStopStart = (count: number): void => {
  if (count > 0) console.log(`[${formatTimestamp()}] Stopping ${count} agent(s) locally...`);
};

const logStopSummary = (stopped: number, failed: number): void => {
  if (failed > 0) {
    console.log(`[${formatTimestamp()}] Shutdown stops: ${stopped} stopped, ${failed} failed`);
  } else if (stopped > 0) {
    console.log(`[${formatTimestamp()}] Shutdown stops: ${stopped} stopped`);
  }
};

const stopActiveAgents = (
  agentPm: DaemonAgentProcessManagerServiceShape,
  activeAgents: ActiveAgent[]
): Effect.Effect<{ stopped: number; failed: number }> =>
  Effect.gen(function* () {
    logStopStart(activeAgents.length);

    // The direct manager remains available after command processing stops.
    // Slot identity prevents a stale snapshot from stopping a replacement.
    const results = yield* Effect.forEach(activeAgents, (agent) =>
      stopAgentFromSnapshot(agentPm, agent)
    );
    const failed = results.filter((success) => !success).length;
    const stopped = activeAgents.length - failed;
    logStopSummary(stopped, failed);
    return { stopped, failed };
  });

const recoverTasksAfterStops = (
  session: {
    taskService: {
      recoverInFlightTasks(args: { mode: 'automatic' }): Promise<{ released: number }>;
    };
  },
  failedStops: number
): Effect.Effect<void> =>
  Effect.promise(async () => {
    if (failedStops > 0) {
      console.warn(`[shutdown] Skipped task recovery because ${failedStops} agent stop(s) failed`);
      return;
    }

    // TaskService applies the authoritative selector, including automatic
    // recovery exclusions. Run it with no local slots as well.
    try {
      const { released } = await session.taskService.recoverInFlightTasks({ mode: 'automatic' });
      if (released > 0) {
        console.log(`[${formatTimestamp()}] Released ${released} in-flight task(s) to pending`);
      }
    } catch (error) {
      console.warn(
        `[${formatTimestamp()}] Failed to recover in-flight tasks on shutdown: ${errorMessage(error)}`
      );
    }
  });

export const onDaemonShutdownEffect: Effect.Effect<
  void,
  never,
  DaemonAgentProcessManagerService | DaemonSessionService
> = Effect.gen(function* () {
  const agentPm = yield* DaemonAgentProcessManagerService;
  const session = yield* DaemonSessionService;

  // Kill all running command processes before stopping agents.
  yield* shutdownAllCommandsEffect;

  // Give any in-progress agent turn time to end gracefully.
  yield* Effect.race(
    agentPm.whenTurnEndsIdle(),
    Effect.sleep(SCOPE_TARGET_STOP_TIMEOUT_MS).pipe(
      Effect.tap(() => Effect.sync(() => console.log('[shutdown] idle wait timed out, proceeding')))
    )
  );

  const activeAgents = agentPm.listActive();
  const { failed } = yield* stopActiveAgents(agentPm, activeAgents);
  yield* recoverTasksAfterStops(session, failed);

  // Mark daemon offline (best-effort).
  yield* Effect.promise(() =>
    session.backend
      .mutation(api.machines.markDaemonOffline, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
      .catch(() => {})
  );
});
