/**
 * State Recovery Handler — recovers agent state on daemon restart.
 */

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import type { DaemonContext } from '../types.js';
import { clearAgentPidEverywhere } from './shared.js';

/**
 * Recover agent state on daemon restart.
 *
 * Reads locally persisted PIDs from the per-machine state file
 * (~/.chatroom/machines/state/<machine-id>.json), verifies each is still
 * alive using `agentServices.isAlive()`, and reconciles with Convex:
 * - Alive agents: log as recovered, keep PID in local state and Convex
 * - Dead agents: clear PID from local state and Convex
 *
 * Also recovers `activeWorkingDirs` from the backend's team agent configs
 * so git state collection starts immediately without waiting for a new agent start.
 *
 * This runs once on daemon startup before command processing begins.
 */
export async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  const entries = ctx.deps.machine.listAgentEntries(ctx.machineId);

  if (entries.length === 0) {
    console.log(`   No agent entries found — nothing to recover`);
  } else {
    let recovered = 0;
    let cleared = 0;

    // Collect unique chatroomIds for working dir recovery below
    const chatroomIds = new Set<string>();

    for (const { chatroomId, role, entry } of entries) {
      const { pid, harness } = entry;
      // Any service can check a PID (it's an OS-level check via kill(pid, 0)).
      // Use the harness-specific service if available, fall back to any available.
      const service = ctx.agentServices.get(harness) ?? ctx.agentServices.values().next().value;
      const alive = service ? service.isAlive(pid) : false;

      if (alive) {
        console.log(`   ✅ Recovered: ${role} (PID ${pid}, harness: ${harness})`);
        recovered++;
        chatroomIds.add(chatroomId);
      } else {
        console.log(`   🧹 Stale PID ${pid} for ${role} — clearing`);
        await clearAgentPidEverywhere(ctx, chatroomId as Id<'chatroom_rooms'>, role);
        cleared++;
      }
    }

    console.log(`   Recovery complete: ${recovered} alive, ${cleared} stale cleared`);

    // Recover active working directories from backend configs for alive agents.
    // Non-critical: working dirs will be populated as new agents start even if this fails.
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
}
