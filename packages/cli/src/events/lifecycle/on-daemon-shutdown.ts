import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import { formatTimestamp } from '../../daemon/entry/daemon-utils.js';
import { shutdownAllCommandsEffect } from '../../daemon/entry/handlers/command-runner.js';

export const onDaemonShutdownEffect: Effect.Effect<
  void,
  never,
  DaemonAgentProcessManagerCommandService | DaemonSessionService
> = Effect.gen(function* () {
  const agentPm = yield* DaemonAgentProcessManagerCommandService;
  const session = yield* DaemonSessionService;

  // Kill all running command processes before stopping agents
  yield* shutdownAllCommandsEffect;

  // Wait for any in-progress agent turn to end gracefully
  yield* Effect.race(
    Effect.promise(() => agentPm.whenTurnEndsIdle()),
    Effect.sleep(SCOPE_TARGET_STOP_TIMEOUT_MS).pipe(
      Effect.tap(() => Effect.sync(() => console.log('[shutdown] idle wait timed out, proceeding')))
    )
  );

  const activeAgents = agentPm.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s) locally...`);

    // Release every non-pending task the machine's roles hold back to
    // `pending` before stopping agents — once the daemon exits, no agent on
    // this machine can be processing anything, so all in-flight tasks must be
    // reprocessable on the next boot. Runs as one machine-scoped backend
    // mutation so it also covers tasks the local read model may have lost.
    yield* Effect.promise(async () => {
      try {
        const tasksReleased = await session.backend.mutation(
          api.daemon.taskStatus.releaseMachineTasks,
          {
            sessionId: session.sessionId,
            machineId: session.machineId,
          }
        );
        if (tasksReleased > 0) {
          console.log(
            `[${formatTimestamp()}] Released ${tasksReleased} in-flight task(s) to pending`
          );
        }
      } catch (error) {
        console.log(
          `[${formatTimestamp()}] ⚠️  Failed to release in-flight tasks on shutdown: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    });

    let totalStopped = 0;
    let totalFailed = 0;
    yield* Effect.all(
      activeAgents.map(({ chatroomId, role }) =>
        Effect.promise(() =>
          agentPm.stopAgent({ chatroomId, role, reason: 'daemon.shutdown' })
        ).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              totalStopped += 1;
            })
          ),
          Effect.catchAll((e) =>
            Effect.sync(() => {
              totalFailed += 1;
              console.log(`   ⚠️  Failed to stop ${role}@${chatroomId}: ${(e as Error).message}`);
            })
          )
        )
      ),
      { concurrency: 'unbounded' }
    );

    if (totalFailed > 0) {
      console.log(
        `[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped, ${totalFailed} failed`
      );
    } else if (totalStopped > 0) {
      console.log(`[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped`);
    }
  }

  // Mark daemon offline (best-effort)
  yield* Effect.promise(() =>
    session.backend
      .mutation(api.machines.markDaemonOffline, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
      .catch(() => {})
  );
});
