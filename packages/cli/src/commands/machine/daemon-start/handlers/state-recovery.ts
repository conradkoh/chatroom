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
 *
 * Finally, performs orphan turn cleanup: any harness sessions owned by
 * this machine that are NOT represented in the recovered active slots
 * get their in-flight turns (streaming/pending) marked as 'failed'.
 */
export async function recoverAgentState(ctx: DaemonContext): Promise<void> {
  await ctx.deps.agentProcessManager.recover();

  const activeSlots = ctx.deps.agentProcessManager.listActive();

  if (activeSlots.length === 0) {
    console.log(`   No active agents after recovery`);
  } else {
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

  // ─── Orphan turn cleanup ──────────────────────────────────────────────────
  // Enumerate all harness sessions this machine manages (active or idle status).
  // Any session NOT in the recovered active slots gets its in-flight turns
  // (streaming/pending) marked as 'failed'.
  try {
    const managedSessions = await ctx.deps.backend.query(
      api.daemon.directHarness.turns.getMachineHarnessSessions,
      {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
      }
    );

    let orphanSessionCount = 0;
    let totalFailedTurns = 0;

    for (const session of managedSessions) {
      // Check if this session's chatroom has a recovered active slot
      const hasActiveSlot = activeSlots.some((s) => s.chatroomId === session.chatroomId);
      if (hasActiveSlot) continue;

      // This session is an orphan — mark its in-flight turns as failed
      try {
        const result = await ctx.deps.backend.mutation(
          api.daemon.directHarness.turns.markOrphanTurnsFailed,
          {
            sessionId: ctx.sessionId,
            machineId: ctx.machineId,
            harnessSessionId: session.harnessSessionId,
          }
        );
        orphanSessionCount++;
        totalFailedTurns += result.failedTurns;
      } catch (err) {
        // Non-critical — continue processing remaining sessions
        console.warn(
          `[daemon] ⚠️ Failed to mark orphan turns for session ${session.harnessSessionId}: ${(err as Error).message}`
        );
      }
    }

    if (orphanSessionCount > 0) {
      console.log(
        `   🧹 Marked ${totalFailedTurns} turns as failed across ${orphanSessionCount} orphan sessions`
      );
    }
  } catch (err) {
    // Non-critical — orphan cleanup failure should not block daemon startup
    console.warn(`[daemon] ⚠️ Orphan turn cleanup failed: ${(err as Error).message}`);
  }
}
