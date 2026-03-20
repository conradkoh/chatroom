import { api } from '../../api.js';
import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../commands/machine/daemon-start/utils.js';

/**
 * Handle daemon shutdown: stop all agents and update daemon status.
 * Called when the daemon receives SIGINT/SIGTERM/SIGHUP.
 *
 * Uses AgentProcessManager to stop all active agents gracefully.
 */
export async function onDaemonShutdown(ctx: DaemonContext): Promise<void> {
  const activeAgents = ctx.deps.agentProcessManager.listActive();

  if (activeAgents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${activeAgents.length} agent(s)...`);

    // Stop all agents in parallel via the manager
    await Promise.allSettled(
      activeAgents.map(async ({ chatroomId, role, slot }) => {
        try {
          await ctx.deps.agentProcessManager.stop({
            chatroomId,
            role,
            reason: 'user.stop',
          });
          console.log(`   Stopped ${role} (PID ${slot.pid})`);
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
