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
 * After recovery, fetches working directories from backend configs
 * for alive agents so git state collection starts immediately.
 */
export async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  await ctx.deps.agentProcessManager.recover();

  // Recover active working directories from backend configs for alive agents
  const activeSlots = ctx.deps.agentProcessManager.listActive();

  if (activeSlots.length === 0) {
    console.log(`   No active agents after recovery`);
    return;
  }

  // Collect unique chatroomIds
  const chatroomIds = new Set(activeSlots.map((s) => s.chatroomId));

  for (const chatroomId of chatroomIds) {
    try {
      const configsResult = await ctx.deps.backend.query(api.machines.getMachineAgentConfigs, {
        sessionId: ctx.sessionId,
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
      for (const config of configsResult.configs) {
        if (config.machineId === ctx.machineId && config.workingDir) {
          ctx.activeWorkingDirs.add(config.workingDir);
        }
      }
    } catch {
      // Non-critical — skip this chatroom
    }
  }

  if (ctx.activeWorkingDirs.size > 0) {
    console.log(
      `   🔀 Recovered ${ctx.activeWorkingDirs.size} active working dir(s) for git tracking`
    );
  }
}
