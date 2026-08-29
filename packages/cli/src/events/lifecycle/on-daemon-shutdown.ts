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
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s) locally...`);

    let totalStopped = 0;
    let totalFailed = 0;
    yield* Effect.all(
      activeAgents.map(({ chatroomId, role }) =>
        agentPm.stop({ chatroomId, role, reason: 'daemon.shutdown' }).pipe(
          Effect.tap(() => Effect.sync(() => { totalStopped += 1; })),
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
