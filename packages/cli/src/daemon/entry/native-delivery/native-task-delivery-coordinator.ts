import { Effect, Runtime, type Context } from 'effect';

import {
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import {
  explainNativeDeliveryBlock,
} from './native-task-injector-logic.js';
import {
  runNativeInjectionEffect,
  type NativeDeliverySessionHandles,
} from './native-task-injector.js';
import { api } from '../../../api.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import type { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
} from '../../services/agent-process-service/index.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../daemon-services.js';
import {
  filterSnapshotsExcludingRestartInFlight,
} from '../restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';

type TaskDeliveryRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskDeliveryContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps extends NativeDeliverySessionHandles {
  convexUrl: string;
}

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  async reconcileAssignedTasks(params: {
    tasks: AssignedTaskSnapshotView[];
    runtime: TaskDeliveryRuntime;
    effectContext: TaskDeliveryContext;
    agentMgr: DaemonAgentProcessManagerServiceShape;
    runSerializedForAgent: <T>(
      key: AgentKey,
      options: SerializedAgentOperationOptions,
      operation: (
        ops: SerializedAgentOperations,
        context: SerializedAgentOperationContext
      ) => Promise<T>
    ) => Promise<T>;
    sessionDeps: NativeTaskDeliverySessionDeps;
    lifecycleOutbox: {
      enqueue: (
        fact: import('../../domain/entities/agent-lifecycle-fact.js').AgentLifecycleFact
      ) => Promise<unknown>;
    };
    operationalModel: AgentOperationalReadModel;
    isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean;
    machineId: string;
    onTaskDelivered?:
      | ((args: {
          chatroomId: string;
          role: string;
          taskId: string;
          harnessSessionId: string;
        }) => void)
      | undefined;
  }): Promise<void> {
    const tasks = filterSnapshotsExcludingRestartInFlight(params.tasks);
    if (tasks.length === 0) return;
    const serializedOperation = params.runSerializedForAgent;
    const {
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      lifecycleOutbox,
      operationalModel,
      isTaskActive,
      machineId,
      onTaskDelivered,
    } = params;
    const deliveryState = getRoleDeliveryState();

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
        operational: operationalModel.get(row.chatroomId, role),
      });
      if (blockReason) {
        if (isDeliverableTaskStatus(row.status)) {
          logNativeDeliverySkip(role, row.chatroomId, row.taskId, blockReason);
        }
        continue;
      }

      if (isTaskActive({ chatroomId: row.chatroomId, role, taskId: row.taskId as string })) {
        logNativeDeliverySkip(role, row.chatroomId, row.taskId, 'task_state_active');
        continue;
      }

      // Absent harness id is represented as absent (never a pretend
      // session). Cold policy creates a real session inside the injector;
      // continue policy without a session fails before receipt/injection.
      const harnessSessionId = slot?.harnessSessionId;

      if (!deliveryState.tryAcquireDelivery(row.chatroomId, role)) {
        logNativeDeliveryMutexSkip(role, row.chatroomId, row.taskId);
        continue;
      }

      logNativeDeliveryInjecting(role, row.chatroomId, row.taskId);

      await Runtime.runPromise(runtime)(
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
            lifecycleOutbox,
            agentMgr: {
              resumeTurnForSlot: (args) => Effect.runPromise(agentMgr.resumeTurnForSlot(args)),
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
              onTaskDelivered?.({
                chatroomId,
                role,
                taskId: deliveredTaskId,
                harnessSessionId: resolvedSessionId,
              });
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

export function resetRoleDeliveryState(chatroomId: string, role: string): void {
  getRoleDeliveryState().resetDeliveryState(chatroomId, role);
}
