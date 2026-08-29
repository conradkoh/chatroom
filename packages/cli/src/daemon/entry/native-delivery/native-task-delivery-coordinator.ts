import { Effect, Runtime, type Context } from 'effect';

import { getNativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  logNativeDeliveryInjecting,
  logNativeDeliveryFallback,
  logNativeDeliveryMutexSkip,
  logNativeDeliveryNoTasks,
  logNativeDeliveryPrimary,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import { getNativeDeliverySession } from './native-delivery-session-registry.js';
import { isStaleTurnInFlightWhileWaiting } from './native-stale-turn-phase.js';
import {
  explainLedgerDeliveryBlock,
  explainNativeDeliveryBlock,
} from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import { api } from '../../../api.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../daemon-services.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';

type TaskDeliveryRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskDeliveryContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps {
  sessionId: string;
  convexUrl: string;
  machineId: string;
  logEvent?: (event: Record<string, unknown>) => Promise<void>;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

export interface NativeSessionLostParams {
  chatroomId: string;
  role: string;
  harnessSessionId?: string;
}

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  onSessionLost(params: NativeSessionLostParams): void {
    getRoleDeliveryState().resetDeliveryState(params.chatroomId, params.role);
    if (params.harnessSessionId) {
      getNativeDeliveryLedger().clearSession(params.harnessSessionId);
    }
  }

  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  tryInjectNextForRole(chatroomId: string, role: string): void {
    if (isRestartOrchestratorInFlight(chatroomId, role)) return;
    const session = getNativeDeliverySession();
    if (!session) return;

    const { runtime, effectContext, agentMgr, sessionDeps, machineId } = session;
    const tasks = session.taskSnapshotState?.listForRole(chatroomId, role) ?? [];
    if (tasks.length === 0) {
      logNativeDeliveryNoTasks(role, chatroomId);
      return;
    }
    this.reconcileAssignedTasks({
      tasks,
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      machineId,
    });
  }

  // fallow-ignore-next-line complexity
  reconcileAssignedTasks(params: {
    tasks: AssignedTaskSnapshotView[];
    runtime: TaskDeliveryRuntime;
    effectContext: TaskDeliveryContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    sessionDeps: NativeTaskDeliverySessionDeps;
    machineId: string;
  }): void {
    const tasks = filterSnapshotsExcludingRestartInFlight(params.tasks);
    if (tasks.length === 0) return;
    const { runtime, effectContext, agentMgr, sessionDeps, machineId } = params;
    const deliveryState = getRoleDeliveryState();
    const ledger = getNativeDeliveryLedger();

    const pendingFirst = [...tasks].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return a.createdAt - b.createdAt;
    });

    for (const row of pendingFirst) {
      const { role } = row.agentConfig;
      let slot = agentMgr.getSlot(row.chatroomId, role);
      if (row.status === 'pending' && slot?.lastInFlightTaskId === row.taskId) {
        Effect.runSync(agentMgr.clearLastInFlightTaskIfMatches(row.chatroomId, role, row.taskId));
      }
      if (isStaleTurnInFlightWhileWaiting(row, slot)) {
        if (agentMgr.reconcileNativeTurnPhaseIdle) {
          Effect.runSync(agentMgr.reconcileNativeTurnPhaseIdle(row.chatroomId, role));
        }
        logNativeDeliveryFallback('stale-turn-phase', role, row.chatroomId, row.taskId);
        slot = agentMgr.getSlot(row.chatroomId, role) ?? undefined;
      }
      const blockReason = explainNativeDeliveryBlock(row, {
        slot,
      });
      if (blockReason) {
        if (isDeliverableTaskStatus(row.status)) {
          logNativeDeliverySkip(role, row.chatroomId, row.taskId, blockReason);
        }
        continue;
      }

      const harnessSessionId = slot?.harnessSessionId;
      if (!harnessSessionId) {
        logNativeDeliverySkip(
          role,
          row.chatroomId,
          row.taskId,
          'harness_session_missing (pre-gate)'
        );
        continue;
      }

      const ledgerBlock = explainLedgerDeliveryBlock(row.taskId, harnessSessionId, ledger);
      if (ledgerBlock) {
        logNativeDeliverySkip(role, row.chatroomId, row.taskId, ledgerBlock);
        continue;
      }
      if (!ledger.tryAcquire(row.taskId, harnessSessionId)) {
        logNativeDeliverySkip(
          role,
          row.chatroomId,
          row.taskId,
          'delivery_ledger_busy (duplicate inject in flight)'
        );
        continue;
      }

      if (!deliveryState.tryAcquireDelivery(row.chatroomId, role)) {
        ledger.clearDelivery(row.taskId, harnessSessionId);
        logNativeDeliveryMutexSkip(role, row.chatroomId, row.taskId);
        continue;
      }

      logNativeDeliveryInjecting(role, row.chatroomId, row.taskId);

      const taskId = row.taskId;
      let deliveredToHarness = false;

      Runtime.runFork(runtime)(
        Effect.gen(function* () {
          const backend = (yield* Effect.tryPromise(() =>
            sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
              sessionId: sessionDeps.sessionId,
              machineId,
              taskId: row.taskId,
              role: row.agentConfig.role,
            })
          )) as Parameters<typeof mapAssignedTaskView>[0] | null;

          if (!backend) {
            console.warn(
              `[NativeDelivery:skip] ${role}@${row.chatroomId} task ${row.taskId} — task_hydrate_missing (deleted or not assigned)`
            );
            return;
          }

          const full = mapAssignedTaskView(backend);

          yield* runNativeInjectionEffect(full, harnessSessionId, {
            sessionId: sessionDeps.sessionId,
            machineId: sessionDeps.machineId,
            logEvent: sessionDeps.logEvent,
            backend: sessionDeps.backend,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
              stop: (opts) => Effect.runPromise(agentMgr.stop(opts)),
              ensureRunning: (opts) => Effect.runPromise(agentMgr.ensureRunning(opts)),
              getSlot: (chatroomId, role) => agentMgr.getSlot(chatroomId, role),
            },
            convexUrl: sessionDeps.convexUrl,
            onTaskDelivered: ({ chatroomId, role, taskId: deliveredTaskId }) => {
              deliveredToHarness = true;
              ledger.markDelivered(deliveredTaskId, harnessSessionId);
              Effect.runSync(agentMgr.setLastInFlightTask(chatroomId, role, deliveredTaskId));
              deliveryState.clearNativeNudgeFailures(chatroomId, role);
            },
          });
        }).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[NativeTaskDelivery] delivery failed for ${row.agentConfig.role}@${row.chatroomId}: ${getErrorMessage(err)}`
              )
            )
          ),
          Effect.ensuring(
            Effect.sync(() => {
              deliveryState.releaseDelivery(row.chatroomId, row.agentConfig.role);
              if (!deliveredToHarness) {
                ledger.clearDelivery(taskId, harnessSessionId);
              }
            })
          )
        )
      );
      // Serial native delivery per role — one task at a time
      break;
    }
  }
}

let coordinator: NativeTaskDeliveryCoordinator | undefined;

export function getNativeTaskDeliveryCoordinator(): NativeTaskDeliveryCoordinator {
  coordinator ??= new NativeTaskDeliveryCoordinator();
  return coordinator;
}

export function notifyNativeSessionLost(params: NativeSessionLostParams): void {
  getNativeTaskDeliveryCoordinator().onSessionLost(params);
}

export function resetRoleDeliveryState(chatroomId: string, role: string): void {
  getRoleDeliveryState().resetDeliveryState(chatroomId, role);
}

export function notifyNativeTurnIdle(params: { chatroomId: string; role: string }): void {
  if (isRestartOrchestratorInFlight(params.chatroomId, params.role)) return;
  logNativeDeliveryPrimary(params.role, params.chatroomId);
  getNativeTaskDeliveryCoordinator().tryInjectNextForRole(params.chatroomId, params.role);
}
