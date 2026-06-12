/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to AgentProcessManager.recover() for PID recovery.
 */

import { Effect } from 'effect';

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import type { BackendOps } from '../../../../infrastructure/deps/index.js';
import { DaemonAgentProcessManagerService, DaemonSessionService } from '../daemon-services.js';
import type { MachineConfig, SessionId } from '../types.js';

/**
 * Minimal deps consumed by recoverAgentStatePostRecoveryCore.
 * DaemonSessionServiceShape satisfies this type structurally — no casts needed.
 */
type RecoverAgentStateDeps = {
  sessionId: SessionId;
  machineId: string;
  config: MachineConfig | null;
  backend: BackendOps;
};

/**
 * Post-recovery async core — workspace registration and orphan turn cleanup.
 *
 * Plain async function so native try/catch error-isolation is preserved
 * byte-for-byte. Called by recoverAgentStateEffect.
 *
 * @param deps  - Session identity + backend ops (DaemonSessionServiceShape satisfies this)
 * @param activeSlots - Slots from agentMgr.listActive(); body only reads .chatroomId
 */
// fallow-ignore-next-line unused-export
export async function recoverAgentStatePostRecoveryCore(
  deps: RecoverAgentStateDeps,
  activeSlots: { chatroomId: string }[]
): Promise<void> {
  if (activeSlots.length === 0) {
    console.log(`   No active agents after recovery`);
  } else {
    // Collect unique chatroomIds
    const chatroomIds = new Set(activeSlots.map((s) => s.chatroomId));
    let registeredCount = 0;

    for (const chatroomId of chatroomIds) {
      try {
        const configsResult = await deps.backend.query(api.machines.getMachineAgentConfigs, {
          sessionId: deps.sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        });
        for (const config of configsResult.configs) {
          if (config.machineId === deps.machineId && config.workingDir) {
            registeredCount++;

            // Register workspace (fire-and-forget — don't block recovery)
            deps.backend
              .mutation(api.workspaces.registerWorkspace, {
                sessionId: deps.sessionId,
                chatroomId: chatroomId as Id<'chatroom_rooms'>,
                machineId: deps.machineId,
                workingDir: config.workingDir,
                hostname: deps.config?.hostname ?? 'unknown',
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
    const managedSessions = await deps.backend.query(
      api.daemon.directHarness.turns.getMachineHarnessSessions,
      {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
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
        const result = await deps.backend.mutation(
          api.daemon.directHarness.turns.markOrphanTurnsFailed,
          {
            sessionId: deps.sessionId,
            machineId: deps.machineId,
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

/**
 * Effect twin — recover + listActive via the granular services, then delegate
 * the post-recovery async work to recoverAgentStatePostRecoveryCore.
 *
 * Split at the recover()/listActive() seam: only the first two calls touch
 * AgentProcessManager; everything after is pure backend + session identity.
 */
export const recoverAgentStateEffect: Effect.Effect<
  void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const agentMgr = yield* DaemonAgentProcessManagerService;
  yield* agentMgr.recover(); // Effect.Effect<void, never, never> — idiomatic
  const activeSlots = agentMgr.listActive(); // synchronous
  yield* Effect.promise(() => recoverAgentStatePostRecoveryCore(session, activeSlots));
});
