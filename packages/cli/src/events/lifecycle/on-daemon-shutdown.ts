import { api } from '../../api.js';
import type { DaemonContext } from '../../commands/machine/daemon-start/types.js';
import { formatTimestamp } from '../../commands/machine/daemon-start/utils.js';
import { onAgentShutdown } from './on-agent-shutdown.js';

const AGENT_SHUTDOWN_TIMEOUT_MS = 5_000;

/**
 * Handle daemon shutdown: stop all agents and update daemon status.
 * Called when the daemon receives SIGINT/SIGTERM/SIGHUP.
 */
export async function onDaemonShutdown(ctx: DaemonContext): Promise<void> {
  const agents = ctx.deps.machine.listAgentEntries(ctx.machineId);

  if (agents.length > 0) {
    console.log(`[${formatTimestamp()}] Stopping ${agents.length} agent(s)...`);

    // Phase 1: Send SIGTERM + cleanup for all agents in parallel
    await Promise.allSettled(
      agents.map(async ({ chatroomId, role, entry }) => {
        const result = await onAgentShutdown(ctx, {
          chatroomId,
          role,
          pid: entry.pid,
        });
        if (result.killed) {
          console.log(`   Sent SIGTERM to ${role} (PID ${entry.pid})`);
        } else {
          console.log(`   ${role} (PID ${entry.pid}) already exited`);
        }
        return result;
      })
    );

    // Phase 2: Wait, then force-kill stragglers
    await ctx.deps.clock.delay(AGENT_SHUTDOWN_TIMEOUT_MS);

    for (const { role, entry } of agents) {
      try {
        ctx.deps.processes.kill(entry.pid, 0);
        ctx.deps.processes.kill(entry.pid, 'SIGKILL');
        console.log(`   Force-killed ${role} (PID ${entry.pid})`);
      } catch {
        // Process exited cleanly
      }
    }

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
