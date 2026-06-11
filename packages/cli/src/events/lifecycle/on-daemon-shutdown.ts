import { Effect } from 'effect';

import { api } from '../../api.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../commands/machine/daemon-start/daemon-services.js';
import {
  shutdownAllCommands,
  shutdownAllCommandsEffect,
} from '../../commands/machine/daemon-start/handlers/command-runner.js';
import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../commands/machine/daemon-start/utils.js';

/**
 * Handle daemon shutdown: stop all agents and update daemon status.
 * Called when the daemon receives SIGINT/SIGTERM/SIGHUP.
 *
 * Uses AgentProcessManager to stop all active agents gracefully.
 */
/**
 * @deprecated Use onDaemonShutdownEffect for new Effect-based code.
 */
export async function onDaemonShutdown(ctx: DaemonContext): Promise<void> {
  // Kill all running command processes before stopping agents
  await shutdownAllCommands(ctx);

  await ctx.deps.agentProcessManager.whenTurnEndsIdle();

  const activeAgents = ctx.deps.agentProcessManager.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s)...`);

    // Stop all agents in parallel via the manager
    await Promise.allSettled(
      activeAgents.map(async ({ chatroomId, role, slot }) => {
        // Capture PID before stop() — doStop() clears slot.pid during cleanup
        const pid = slot.pid;
        try {
          await ctx.deps.agentProcessManager.stop({
            chatroomId,
            role,
            reason: 'daemon.shutdown',
          });
          console.log(`   Stopped ${role} (PID ${pid})`);
        } catch (e) {
          console.log(`   ⚠️  Failed to stop ${role}: ${(e as Error).message}`);
        }
      })
    );

    console.log(`[${formatTimestamp()}] All agents stopped`);
  }

  // Update daemon status to disconnected
  try {
    await ctx.deps.backend.mutation(api.machines.updateDaemonStatus, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      connected: false,
    });
  } catch {
    // Best-effort
  }
}

// fallow-ignore-next-line unused-export
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
