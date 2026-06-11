import { Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../commands/machine/daemon-start/daemon-services.js';
import { shutdownAllCommandsEffect } from '../../commands/machine/daemon-start/handlers/command-runner.js';
import { formatTimestamp } from '../../commands/machine/daemon-start/utils.js';

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

    yield* Effect.promise(() =>
      Promise.allSettled(
        activeAgents.map(async ({ chatroomId, role, slot }) => {
          const pid = slot.pid;
          try {
            await Effect.runPromise(agentPm.stop({ chatroomId, role, reason: 'daemon.shutdown' }));
            console.log(`   Stopped ${role} (PID ${pid})`);
          } catch (e) {
            console.log(`   ⚠️  Failed to stop ${role}: ${(e as Error).message}`);
          }
        })
      )
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
