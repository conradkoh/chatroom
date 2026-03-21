/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to AgentProcessManager.recover() for PID recovery.
 */

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import type { DaemonContext } from '../types.js';

/**
 * Recover agent state on daemon restart.
 *
 * Delegates to AgentProcessManager.recover() which:
 * - Reads locally persisted PIDs from disk
 * - Verifies each is still alive (kill(pid, 0))
 * - Creates running slots for alive agents
 * - Clears dead agent PIDs from disk
 *
 * After recovery, registers workspaces for alive agents via the backend
 * workspace registry (fire-and-forget mutations).
 */
export async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  await ctx.deps.agentProcessManager.recover();

  const activeSlots = ctx.deps.agentProcessManager.listActive();

  if (activeSlots.length === 0) {
    console.log(`   No active agents after recovery`);
    return;
  }

  // Collect unique chatroomIds
  const chatroomIds = new Set(activeSlots.map((s) => s.chatroomId));
  let registeredCount = 0;

  for (const chatroomId of chatroomIds) {
    try {
      const configsResult = await ctx.deps.backend.query(api.machines.getMachineAgentConfigs, {
        sessionId: ctx.sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
      for (const config of configsResult.configs) {
        if (config.machineId === ctx.machineId && config.workingDir) {
          registeredCount++;

          // Register workspace (fire-and-forget — don't block recovery)
          ctx.deps.backend
            .mutation(api.workspaces.registerWorkspace, {
              sessionId: ctx.sessionId,
              chatroomId: chatroomId as Id<'chatroom_rooms'>,
              machineId: ctx.machineId,
              workingDir: config.workingDir,
              hostname: ctx.config?.hostname ?? 'unknown',
              registeredBy: config.role,
            })
            .catch((err: Error) => {
              console.warn(
                `[daemon] ⚠️ Failed to register workspace on recovery: ${err.message}`
              );
            });
        }
      }
    } catch {
      // Non-critical — skip this chatroom
    }
  }

  if (registeredCount > 0) {
    console.log(`   🔀 Registered ${registeredCount} workspace(s) on recovery`);
  }
}
