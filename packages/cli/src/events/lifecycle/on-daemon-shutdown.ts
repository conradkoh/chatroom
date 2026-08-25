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
  yield* agentPm.whenTurnEndsIdle();

  const activeAgents = agentPm.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s)...`);

    const chatroomIds = [...new Set(activeAgents.map(({ chatroomId }) => chatroomId))];
    yield* Effect.all(
      chatroomIds.map((chatroomId) => Effect.promise(async () => {
        const result = await session.backend.mutation(api.agentStops.requestScope, {
          sessionId: session.sessionId, machineId: session.machineId, chatroomId,
          scope: { kind: 'chatroom' }, reason: 'daemon.shutdown',
        });
        if (!result.inboxCommandId) return;
        if (!agentPm.executeScopedStopForCommand) return;
        await Effect.runPromise(agentPm.executeScopedStopForCommand({
          stopCommandId: result.stopCommandId as string, chatroomId,
          scope: { kind: 'chatroom' }, reason: 'daemon.shutdown', inboxCommandId: result.inboxCommandId as string,
        }));
      }).pipe(Effect.catchAll((e) => Effect.sync(() => console.log(`   ⚠️  Failed chatroom stop: ${(e as Error).message}`))))) ,
      { concurrency: 'unbounded' }
    );

    console.log(`[${formatTimestamp()}] All agents stopped`);
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
