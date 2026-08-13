import type { DatabaseSync } from 'node:sqlite';

import { Effect, Runtime, type Context } from 'effect';

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
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import { isDaemonTaskId } from '../../domain/entities/daemon-task-id.js';
import { listAssignedTaskSnapshotsForRole } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import {
  claimTaskReadModelLocally,
  getTaskContentFromReadModel,
  listDeliverableSnapshotsForRole,
} from '../../infrastructure/persistence/read-models/tasks.js';
import { backfillPendingTasksForChatroomRole } from '../../infrastructure/persistence/read-models/backfill-pending-tasks.js';
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

let readModelDb: DatabaseSync | undefined;
export function setNativeDeliveryReadModelDb(db: DatabaseSync | undefined): void {
  readModelDb = db;
}

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
    if (isRestartOrchestratorInFlight(chatroomId, role)) return;
    const session = getNativeDeliverySession();
    if (!session) return;

    const { runtime, effectContext, agentMgr, sessionDeps, machineId } = session;
    const tasks = readModelDb
      ? listDeliverableSnapshotsForRole(readModelDb, chatroomId, role)
      : listAssignedTaskSnapshotsForRole(chatroomId, role);
    if (tasks.length === 0 && readModelDb) {
      void this.backfillAndInject(chatroomId, role, session);
      return;
    }
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

  private async backfillAndInject(
    chatroomId: string,
    role: string,
    session: NonNullable<ReturnType<typeof getNativeDeliverySession>>
  ): Promise<void> {
    if (!readModelDb) return;
    const { runtime, effectContext, agentMgr, sessionDeps, machineId } = session;
    try {
      await backfillPendingTasksForChatroomRole(
        {
          db: readModelDb,
          machineId,
          sessionId: sessionDeps.sessionId,
          query: sessionDeps.backend.query,
        },
        chatroomId,
        role
      );
    } catch (err) {
      console.warn(
        `[NativeTaskDelivery] pending-task backfill failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
      );
    }

    const tasks = listDeliverableSnapshotsForRole(readModelDb, chatroomId, role);
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
    const tasks = filterSnapshotsExcludingRestartInFlight(params.tasks);
    if (tasks.length === 0) return;
    const { runtime, effectContext, agentMgr, sessionDeps } = params;
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
          const taskContent = readModelDb
            ? getTaskContentFromReadModel(readModelDb, row.chatroomId, role, row.taskId)
            : undefined;
          const useLocalDelivery = Boolean(
            readModelDb && taskContent && isDaemonTaskId(row.taskId)
          );

          if (useLocalDelivery && readModelDb) {
            claimTaskReadModelLocally(
              readModelDb,
              row.chatroomId,
              role,
              row.taskId,
              Date.now(),
              sessionDeps.sessionId,
              sessionDeps.machineId
            );
          }

          yield* runNativeInjectionEffect(
            { ...row, status: useLocalDelivery ? 'in_progress' : row.status, taskContent: taskContent ?? '' },
            harnessSessionId,
            {
              sessionId: sessionDeps.sessionId,
              machineId: sessionDeps.machineId,
              convexUrl: sessionDeps.convexUrl,
              backend: sessionDeps.backend,
              localDelivery: useLocalDelivery,
              agentMgr: {
                resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
              },
              onTaskDelivered: ({ chatroomId, role, taskId: deliveredTaskId }) => {
                deliveredToHarness = true;
                ledger.markDelivered(deliveredTaskId, harnessSessionId);
                Effect.runSync(agentMgr.setLastInFlightTask(chatroomId, role, deliveredTaskId));
              },
            }
          );
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
