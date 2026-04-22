/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to AgentProcessManager.recover() for PID and SDK session recovery.
 */

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import type { DaemonContext } from '../types.js';

/**
 * Recover agent state on daemon restart.
 *
 * Two-phase recovery:
 * 1. Process-based recovery: Delegates to AgentProcessManager.recover() which:
 *    - Reads locally persisted PIDs from disk
 *    - Verifies each is still alive (kill(pid, 0))
 *    - Creates running slots for alive agents
 *    - Clears dead agent PIDs from disk
 *    - For SDK drivers with sessionPersistence, calls driver.recover() and creates slots with agentHandle
 *
 * 2. Convex reconciliation: For recovered SDK handles, update Convex rows with sessionId/serverUrl,
 *    and clean up orphan sessions (handles with no matching Convex row).
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

      // Reconcile recovered SDK handles with Convex rows
      for (const entry of activeSlots.filter((s) => s.chatroomId === chatroomId)) {
        if (entry.slot.agentHandle && entry.slot.harness === 'opencode-sdk') {
          // Find matching Convex row (same workingDir and harness)
          const matchingConfig = configsResult.configs.find(
            (c: any) =>
              c.machineId === ctx.machineId &&
              c.agentType === 'opencode-sdk' &&
              c.workingDir === entry.slot.workingDir
          );

          if (matchingConfig) {
            // Update the config with recovered session fields (fire-and-forget)
            ctx.deps.backend
              .mutation(api.machines.updateSdkSessionState, {
                sessionId: ctx.sessionId,
                machineId: ctx.machineId,
                chatroomId: chatroomId as Id<'chatroom_rooms'>,
                role: matchingConfig.role,
                recoveredSessionId: entry.slot.agentHandle.sessionId,
                recoveredServerUrl: entry.slot.agentHandle.serverUrl,
              })
              .catch((err: Error) => {
                console.warn(
                  `[daemon] ⚠️ Failed to reconcile SDK session on recovery: ${err.message}`
                );
              });
          } else {
            // Orphan session — log warning (cleanup via driver.stop() happens in AgentProcessManager)
            console.warn(
              `[daemon] ⚠️ Recovered SDK session for workingDir '${entry.slot.workingDir}' has no matching Convex config`
            );
          }
        }
      }

      // Register workspaces for all active agents
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
              console.warn(`[daemon] ⚠️ Failed to register workspace on recovery: ${err.message}`);
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
