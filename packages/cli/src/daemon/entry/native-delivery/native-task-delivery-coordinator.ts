import { Effect, Runtime, type Context } from 'effect';

import { getNativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliveryPrimary,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import {
  getNativeDeliverySession,
  recordNativeTaskDelivered,
} from './native-delivery-session-registry.js';
import {
  explainLedgerDeliveryBlock,
  explainNativeDeliveryBlock,
} from './native-task-injector-logic.js';
import {
  runNativeInjectionEffect,
  type NativeDeliverySessionHandles,
} from './native-task-injector.js';
import { api } from '../../../api.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
} from '../../infrastructure/agent-process-manager/service/index.js';
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

export interface NativeTaskDeliverySessionDeps extends NativeDeliverySessionHandles {
  convexUrl: string;
}

export interface NativeSessionLostParams {
  chatroomId: string;
  role: string;
  harnessSessionId?: string | undefined;
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
    reconcileDeliverableWorkForRole(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  reconcileAssignedTasks(params: {
    tasks: AssignedTaskSnapshotView[];
    runtime: TaskDeliveryRuntime;
    effectContext: TaskDeliveryContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    runSerializedForAgent?: <T>(
      key: AgentKey,
      options: SerializedAgentOperationOptions,
      operation: (
        ops: SerializedAgentOperations,
        context: SerializedAgentOperationContext
      ) => Promise<T>
    ) => Promise<T>;
    sessionDeps: NativeTaskDeliverySessionDeps;
    machineId: string;
    onTaskDelivered?:
      | ((args: {
          chatroomId: string;
          role: string;
          taskId: string;
          harnessSessionId: string;
        }) => void)
      | undefined;
  }): void {
    const tasks = filterSnapshotsExcludingRestartInFlight(params.tasks);
    if (tasks.length === 0) return;
    const serializedOperation =
      params.runSerializedForAgent ?? getNativeDeliverySession()?.runSerializedForAgent;
    if (!serializedOperation) {
      throw new Error('Native delivery requires AgentProcessManagerService coordination');
    }
    const { runtime, effectContext, agentMgr, sessionDeps, machineId, onTaskDelivered } = params;
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
      const blockReason = explainNativeDeliveryBlock(row, {
        slot,
      });
      if (blockReason) {
        if (isDeliverableTaskStatus(row.status)) {
          logNativeDeliverySkip(role, row.chatroomId, row.taskId, blockReason);
        }
        continue;
      }

      // Absent harness id is represented as absent (never a pretend
      // session). Cold policy creates a real session inside the injector;
      // continue policy without a session fails before receipt/injection.
      const harnessSessionId = slot?.harnessSessionId;

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
        ledger.releaseAttempt(row.taskId);
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
          const deliverySession = getNativeDeliverySession();
          if (!deliverySession?.lifecycleOutbox) return;

          yield* runNativeInjectionEffect(full, harnessSessionId, {
            sessionId: sessionDeps.sessionId,
            machineId: sessionDeps.machineId,
            logEvent: sessionDeps.logEvent,
            backend: sessionDeps.backend,
            lifecycleOutbox: deliverySession.lifecycleOutbox,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
              stop: (opts) => Effect.runPromise(agentMgr.stop(opts)),
              ensureRunning: (opts) => Effect.runPromise(agentMgr.ensureRunning(opts)),
              getSlot: (chatroomId, role) => agentMgr.getSlot(chatroomId, role),
            },
            runSerializedForAgent: serializedOperation,
            convexUrl: sessionDeps.convexUrl,
            onTaskDelivered: ({
              chatroomId,
              role,
              taskId: deliveredTaskId,
              harnessSessionId: resolvedSessionId,
            }) => {
              deliveredToHarness = true;
              ledger.markDelivered(deliveredTaskId, resolvedSessionId);
              if (onTaskDelivered) {
                onTaskDelivered({
                  chatroomId,
                  role,
                  taskId: deliveredTaskId,
                  harnessSessionId: resolvedSessionId,
                });
              } else {
                recordNativeTaskDelivered({
                  chatroomId,
                  role,
                  taskId: deliveredTaskId,
                });
              }
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
              // Finalizer always releases the attempt, including success
              // (markDelivered already released), missing hydrate/outbox,
              // claim/start/prompt failure, and interruption.
              if (!deliveredToHarness) {
                ledger.releaseAttempt(taskId);
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

/** Single delivery entry for a role — inbox SSOT + local readiness gates. */
export function reconcileDeliverableWorkForRole(chatroomId: string, role: string): void {
  if (isRestartOrchestratorInFlight(chatroomId, role)) return;
  const session = getNativeDeliverySession();
  if (!session) return;
  const { runtime, effectContext, agentMgr, sessionDeps, machineId, taskSnapshotState } = session;
  const tasks = taskSnapshotState?.listForRole(chatroomId, role) ?? [];
  if (tasks.length === 0) return;
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent: session.runSerializedForAgent,
    sessionDeps,
    machineId,
  });
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
  reconcileDeliverableWorkForRole(params.chatroomId, params.role);
}
