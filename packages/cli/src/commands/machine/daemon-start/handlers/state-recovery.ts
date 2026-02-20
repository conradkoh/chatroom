/**
 * State Recovery Handler — recovers agent state on daemon restart.
 */

import type { Id } from '../../../../api.js';
import type { DaemonContext } from '../types.js';
import { clearAgentPidEverywhere } from './shared.js';

/**
 * Recover agent state on daemon restart.
 *
 * Reads locally persisted PIDs from the per-machine state file
 * (~/.chatroom/machines/state/<machine-id>.json), verifies each is still
 * alive using `remoteAgentService.isAlive()`, and reconciles with Convex:
 * - Alive agents: log as recovered, keep PID in local state and Convex
 * - Dead agents: clear PID from local state and Convex
 *
 * This runs once on daemon startup before command processing begins.
 */
export async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  const entries = ctx.deps.machine.listAgentEntries(ctx.machineId);

  if (entries.length === 0) {
    console.log(`   No agent entries found — nothing to recover`);
    return;
  }

  let recovered = 0;
  let cleared = 0;

  for (const { chatroomId, role, entry } of entries) {
    const { pid, harness } = entry;
    const alive = ctx.remoteAgentService.isAlive(pid);

    if (alive) {
      console.log(`   ✅ Recovered: ${role} (PID ${pid}, harness: ${harness})`);
      recovered++;
    } else {
      console.log(`   🧹 Stale PID ${pid} for ${role} — clearing`);
      await clearAgentPidEverywhere(ctx, chatroomId as Id<'chatroom_rooms'>, role);
      cleared++;
    }
  }

  console.log(`   Recovery complete: ${recovered} alive, ${cleared} stale cleared`);
}
