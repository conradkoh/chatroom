import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import { formatTimestamp } from '../../daemon/entry/daemon-utils.js';
import { shutdownAllCommandsEffect } from '../../daemon/entry/handlers/command-runner.js';

export const onDaemonShutdownEffect: Effect.Effect<
  void,
  never,
  DaemonAgentProcessManagerService | DaemonSessionService
> = Effect.gen(function* () {
  const agentPm = yield* DaemonAgentProcessManagerService;
  const session = yield* DaemonSessionService;

  // Kill all running command processes before stopping agents
  yield* shutdownAllCommandsEffect;

  // Wait for any in-progress agent turn to end gracefully
  yield* Effect.race(
    agentPm.whenTurnEndsIdle(),
    Effect.sleep(SCOPE_TARGET_STOP_TIMEOUT_MS).pipe(
      Effect.tap(() => Effect.sync(() => console.log('[shutdown] idle wait timed out, proceeding')))
    )
  );

  const activeAgents = agentPm.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s)...`);

    const chatroomIds = [...new Set(activeAgents.map(({ chatroomId }) => chatroomId))];
    let totalStopped = 0;
    let totalFailed = 0;
    yield* Effect.all(
      chatroomIds.map((chatroomId) =>
        Effect.promise(async () => {
          const result = await session.backend.mutation(api.agentStops.requestScope, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            chatroomId,
            scope: { kind: 'chatroom' },
            reason: 'daemon.shutdown',
          });
          if (!result.inboxCommandId) return;
          if (!agentPm.executeScopedStopForCommand) return;
          const summary = await Effect.runPromise(
            agentPm.executeScopedStopForCommand({
              stopCommandId: result.stopCommandId as string,
              chatroomId,
              scope: { kind: 'chatroom' },
              reason: 'daemon.shutdown',
              inboxCommandId: result.inboxCommandId as string,
            })
          );
          totalStopped += summary.stoppedCount;
          totalFailed += summary.failedCount;
        }).pipe(
          Effect.catchAll((e) =>
            Effect.sync(() => {
              totalFailed += 1;
              console.log(`   ⚠️  Failed chatroom stop: ${(e as Error).message}`);
            })
          )
        )
      ),
      { concurrency: 'unbounded' }
    );

    if (totalFailed > 0) {
      console.log(`[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped, ${totalFailed} failed`);
    } else if (totalStopped > 0) {
      console.log(`[${formatTimestamp()}] Shutdown stops: ${totalStopped} stopped`);
    }
  }

  // Update daemon status to disconnected (best-effort)
  yield* Effect.promise(() =>
    session.backend
      .mutation(api.machines.updateDaemonStatus, {
        sessionId: session.sessionId,
        machineId: session.machineId,
        connected: false,
      })
      .catch(() => {})
  );
});
