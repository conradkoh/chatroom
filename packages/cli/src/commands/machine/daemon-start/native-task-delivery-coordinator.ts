import type {
  AssignedTaskSnapshotView,
  AssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { isDeliverableTaskStatus } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect, Runtime, type Context } from 'effect';

import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from './daemon-services.js';
import { getNativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliveryNoTasks,
  logNativeDeliveryPrimary,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import { getNativeDeliverySession } from './native-delivery-session-registry.js';
import {
  explainLedgerDeliveryBlock,
  explainNativeDeliveryBlock,
} from './native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import { api } from '../../../api.js';
import { listAssignedTaskSnapshotsForRole } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps {
  sessionId: string;
  convexUrl: string;
  machineId: string;
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
    const session = getNativeDeliverySession();
    if (!session) return;

    const { runtime, effectContext, agentMgr, sessionDeps, machineId } = session;
    const tasks = listAssignedTaskSnapshotsForRole(chatroomId, role);
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
    runtime: TaskMonitorRuntime;
    effectContext: TaskMonitorContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    sessionDeps: NativeTaskDeliverySessionDeps;
    machineId: string;
  }): void {
    const { tasks, runtime, effectContext, agentMgr, sessionDeps, machineId } = params;
    const deliveryState = getRoleDeliveryState();
    const ledger = getNativeDeliveryLedger();

    const pendingFirst = [...tasks].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return a.createdAt - b.createdAt;
    });

    for (const row of pendingFirst) {
      const { role } = row.agentConfig;
      const slot = agentMgr.getSlot(row.chatroomId, role);
      const blockReason = explainNativeDeliveryBlock(row, { slot });
      if (blockReason) {
        if (isDeliverableTaskStatus(row.status as Parameters<typeof isDeliverableTaskStatus>[0])) {
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
          const full = (yield* Effect.tryPromise(() =>
            sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
              sessionId: sessionDeps.sessionId,
              machineId,
              taskId: row.taskId,
              role: row.agentConfig.role,
            })
          )) as AssignedTaskView | null;

          if (!full) {
            console.warn(
              `[NativeDelivery:skip] ${role}@${row.chatroomId} task ${row.taskId} — task_hydrate_missing (deleted or not assigned)`
            );
            return;
          }

          yield* runNativeInjectionEffect(full, harnessSessionId, {
            sessionId: sessionDeps.sessionId,
            machineId: sessionDeps.machineId,
            backend: sessionDeps.backend,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
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
  logNativeDeliveryPrimary(params.role, params.chatroomId);
  getNativeTaskDeliveryCoordinator().tryInjectNextForRole(params.chatroomId, params.role);
}
