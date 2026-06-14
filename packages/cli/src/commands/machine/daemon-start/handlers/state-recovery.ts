/**
 * State Recovery Handler — recovers agent state on daemon restart.
 * Delegates to AgentProcessManager.recover() for PID recovery.
 */

import { Effect } from 'effect';

import { api } from '../../../../api.js';
import type { Id } from '../../../../api.js';
import { DaemonAgentProcessManagerService, DaemonSessionService } from '../daemon-services.js';

export const recoverAgentStateEffect: Effect.Effect<
  void,
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> = Effect.gen(function* () {
  const session = yield* DaemonSessionService;
  const agentMgr = yield* DaemonAgentProcessManagerService;
  yield* agentMgr.recover();
  const activeSlots = agentMgr.listActive();

  if (activeSlots.length === 0) {
    console.log(`   No active agents after recovery`);
  } else {
    const chatroomIds = new Set(activeSlots.map((s) => s.chatroomId));
    let registeredCount = 0;

    for (const chatroomId of chatroomIds) {
      yield* Effect.catchAll(
        Effect.gen(function* () {
          const configsResult = yield* Effect.tryPromise(() =>
            session.backend.query(api.machines.getMachineAgentConfigs, {
              sessionId: session.sessionId,
              chatroomId: chatroomId as Id<'chatroom_rooms'>,
            })
          );
          for (const config of configsResult.configs) {
            if (config.machineId === session.machineId && config.workingDir) {
              registeredCount++;
              yield* Effect.forkDaemon(
                Effect.tryPromise(() =>
                  session.backend.mutation(api.workspaces.registerWorkspace, {
                    sessionId: session.sessionId,
                    chatroomId: chatroomId as Id<'chatroom_rooms'>,
                    machineId: session.machineId,
                    workingDir: config.workingDir,
                    hostname: session.config?.hostname ?? 'unknown',
                    registeredBy: config.role,
                  })
                ).pipe(
                  Effect.catchAll((err) =>
                    Effect.sync(() =>
                      console.warn(
                        `[daemon] ⚠️ Failed to register workspace on recovery: ${err.message}`
                      )
                    )
                  )
                )
              );
            }
          }
        }),
        () => Effect.void
      );
    }

    if (registeredCount > 0) {
      console.log(`   🔀 Registered ${registeredCount} workspace(s) on recovery`);
    }
  }

  yield* Effect.catchAll(
    Effect.gen(function* () {
      const managedSessions = yield* Effect.tryPromise(() =>
        session.backend.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        })
      );

      let orphanSessionCount = 0;
      let totalFailedTurns = 0;

      for (const hs of managedSessions) {
        const hasActiveSlot = activeSlots.some((s) => s.chatroomId === hs.chatroomId);
        if (hasActiveSlot) continue;

        yield* Effect.catchAll(
          Effect.gen(function* () {
            const result = yield* Effect.tryPromise(() =>
              session.backend.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
                sessionId: session.sessionId,
                machineId: session.machineId,
                harnessSessionId: hs.harnessSessionId,
              })
            );
            orphanSessionCount++;
            totalFailedTurns += result.failedTurns;
          }),
          (err) =>
            Effect.sync(() => {
              console.warn(
                `[daemon] ⚠️ Failed to mark orphan turns for session ${hs.harnessSessionId}: ${(err as Error).message}`
              );
            })
        );
      }

      if (orphanSessionCount > 0) {
        console.log(
          `   🧹 Marked ${totalFailedTurns} turns as failed across ${orphanSessionCount} orphan sessions`
        );
      }
    }),
    (err) =>
      Effect.sync(() => {
        console.warn(`[daemon] ⚠️ Orphan turn cleanup failed: ${(err as Error).message}`);
      })
  );
});
