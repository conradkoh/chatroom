/**
 * Shared helpers used by multiple daemon command handlers.
 */

import { api, type Id } from '../../../../api.js';
import type { DaemonContext } from '../types.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';

/**
 * Clear an agent's PID from both the Convex backend and local state file.
 * Used when stopping agents or cleaning up stale PIDs.
 */
export async function clearAgentPidEverywhere(
  ctx: DaemonContext,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  try {
    await ctx.deps.backend.mutation(api.machines.updateSpawnedAgent, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      chatroomId,
      role,
      pid: undefined,
    });
  } catch (e) {
    console.log(`   ⚠️  Failed to clear PID in backend: ${getErrorMessage(e)}`);
  }
  ctx.deps.machine.clearAgentPid(ctx.machineId, chatroomId, role);
}
