import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import { Effect, Runtime, type Context } from 'effect';

import { decideNextDelivery } from './delivery-decision.js';
import {
  logNativeDeliveryDecision,
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import { api } from '../../../../../api.js';
import { mapAssignedTaskView } from '../../../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { AgentLifecycleFact } from '../../../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../../../domain/entities/assigned-task.js';
import { isSlotIdle } from '../../../../domain/usecase/check-agent-slot.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../../entry/daemon-services.js';
import type { AgentHarness } from '../../../../entry/daemon-types.js';
import { isRestartOrchestratorInFlight } from '../../../../entry/restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../../../../entry/role-delivery-state.js';
import type { AgentOperationalReadModel } from '../../../../infrastructure/agent-operational/agent-operational-read-model.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
  NativeDeliverySessionHandles,
  TaskService,
} from '../../../service-interfaces.js';

type TaskDeliveryService = Pick<
  TaskService,
  | 'deliverNativeTask'
  | 'isNativeHarness'
  | 'snapshotRequestsNativeColdSession'
  | 'explainNativeDeliveryBlock'
>;

type TaskDeliveryRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskDeliveryContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

export interface NativeTaskDeliverySessionDeps extends NativeDeliverySessionHandles {
  convexUrl: string;
}

export type NativeDeliveryDelivered = {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
};

export type NativeDeliveryExecution =
  { kind: 'delivered'; delivered?: NativeDeliveryDelivered } | { kind: 'task-unavailable' };

export type NativeDeliveryExecutors = {
  startAgent: (
    task: AssignedTaskSnapshotView,
    operationalState: string | undefined
  ) => Promise<unknown>;
  injectTask: (
    task: AssignedTaskSnapshotView,
    harnessSessionId: string | undefined
  ) => Promise<NativeDeliveryExecution>;
};

type DeliveryPass =
  | 'inbox-signal'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'operational-status'
  | 'restart'
  | 'agent-started';
type ExtendedDeliveryPass =
  DeliveryPass | 'task-signal' | 'operational-signal' | 'turn-ended' | 'restart-completed';
type LegacyDeliveryPass = 'inbox-signal' | 'operational-status' | 'restart';

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  async reconcileRoleTasks(params: {
    tasks: AssignedTaskSnapshotView[];
    pass?: ExtendedDeliveryPass | LegacyDeliveryPass;
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
    taskService: TaskDeliveryService;
    sessionDeps: NativeTaskDeliverySessionDeps;
    lifecycleOutbox: {
      enqueue: (fact: AgentLifecycleFact) => Promise<unknown>;
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
    executors?: NativeDeliveryExecutors;
  }): Promise<void> {
    const tasks = params.tasks;
    if (tasks.length === 0) return;
    const {
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      operationalModel,
      isTaskActive,
      machineId,
      onTaskDelivered,
      executors,
    } = params;
    const deliveryState = getRoleDeliveryState();
    const taskService = params.taskService;

    const groups = new Map<string, AssignedTaskSnapshotView[]>();
    for (const task of tasks) {
      const key = `${task.chatroomId}:${task.agentConfig.role.toLowerCase()}`;
      const group = groups.get(key) ?? [];
      group.push(task);
      groups.set(key, group);
    }

    for (const roleTasks of groups.values()) {
      const sortedTasks = [...roleTasks].sort((a, b) => {
        if (a.status === 'pending' && b.status !== 'pending') return -1;
        if (b.status === 'pending' && a.status !== 'pending') return 1;
        return a.createdAt - b.createdAt;
      });
      const firstTask = sortedTasks[0];
      if (!firstTask) continue;
      const { role } = firstTask.agentConfig;
      const slot = agentMgr.getSlot(firstTask.chatroomId, role);
      const operational = operationalModel.get(firstTask.chatroomId, role);
      const activeTaskId = roleTasks.find((candidate) =>
        isTaskActive({ chatroomId: candidate.chatroomId, role, taskId: candidate.taskId })
      )?.taskId;
      const decision = decideNextDelivery(roleTasks, {
        role,
        slot,
        operational,
        activeTaskId,
        deliveryInFlight: false,
        agentLifecycleInFlight: isRestartOrchestratorInFlight(firstTask.chatroomId, role),
        isNativeHarness: taskService.isNativeHarness,
        snapshotRequestsNativeColdSession: taskService.snapshotRequestsNativeColdSession,
        explainNativeDeliveryBlock: taskService.explainNativeDeliveryBlock,
      });
      const attemptId = `${Date.now()}-${firstTask.taskId}`;
      const decisionReason = 'reason' in decision ? decision.reason : undefined;
      logNativeDeliveryDecision(
        params.pass ?? 'inbox-signal',
        role,
        firstTask.chatroomId,
        decision.kind === 'blocked' || decision.kind === 'wait'
          ? `${decision.kind}:${decision.reason}`
          : decision.kind,
        'taskId' in decision ? decision.taskId : undefined,
        {
          ...(decisionReason ? { reason: decisionReason } : {}),
          attemptId,
          slotState: slot?.state ?? 'missing',
          nativeTurnPhase: slot?.nativeTurnPhase ?? 'unknown',
          harnessSessionPresent: Boolean(slot?.harnessSessionId),
          operationalState: operational?.operationalState ?? 'missing',
        }
      );

      const row =
        ('taskId' in decision
          ? sortedTasks.find((candidate) => candidate.taskId === decision.taskId)
          : firstTask) ?? firstTask;

      if (decision.kind === 'idle' || decision.kind === 'blocked' || decision.kind === 'wait') {
        if (decision.kind === 'blocked') {
          logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        }
        continue;
      }
      if (decision.kind === 'deduplicated') {
        logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        continue;
      }
      if (decision.kind === 'start-agent') {
        if (!row.agentConfig.workingDir || (slot && !isSlotIdle(slot.state))) continue;
        try {
          if (executors) {
            const startResult = await executors.startAgent(row, operational?.operationalState);
            console.log(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=start-agent result=${startResult && typeof startResult === 'object' && 'success' in startResult ? startResult.success : 'completed'}`
            );
            continue;
          }
          const startResult = await params.runSerializedForAgent(
            { chatroomId: row.chatroomId, role },
            { timeoutMs: 120_000 },
            (ops, context) =>
              ops.startAgent(
                {
                  chatroomId: row.chatroomId,
                  role,
                  agentHarness: row.agentConfig.agentHarness as AgentHarness,
                  model: row.agentConfig.model ?? '',
                  workingDir: row.agentConfig.workingDir as string,
                  reason:
                    operational?.operationalState === 'running'
                      ? AgentStartReasonEnum['platform.task_monitor_nudge']
                      : AgentStartReasonEnum['platform.pending_task_wake'],
                  wantResume: false,
                  lifecycleRevision: row.agentConfig.configLifecycleRevision,
                  taskId: row.taskId,
                },
                context.signal
              )
          );
          console.log(
            `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=start-agent result=${startResult && typeof startResult === 'object' && 'success' in startResult ? startResult.success : 'completed'}`
          );
        } catch (error) {
          console.warn(
            `[NativeDelivery:failure] role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=start-agent error=${getErrorMessage(error)}`
          );
        }
        continue;
      }

      if (!deliveryState.tryAcquireDelivery(row.chatroomId, role)) {
        logNativeDeliveryMutexSkip(role, row.chatroomId, row.taskId);
        continue;
      }

      const harnessSessionId = decision.harnessSessionId;
      logNativeDeliveryInjecting(role, row.chatroomId, row.taskId);
      if (executors) {
        try {
          const result = await executors.injectTask(row, harnessSessionId);
          if (result.kind === 'task-unavailable') {
            console.warn(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
            );
          } else if (result.delivered) {
            onTaskDelivered?.(result.delivered);
            deliveryState.clearNativeNudgeFailures(row.chatroomId, role);
            console.log(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=success`
            );
          }
        } catch (error) {
          console.warn(
            `[NativeDelivery:failure] role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject error=${getErrorMessage(error)}`
          );
        } finally {
          deliveryState.releaseDelivery(row.chatroomId, role);
        }
        continue;
      }
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
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
            );
            return;
          }

          const full = mapAssignedTaskView(backend);
          yield* Effect.tryPromise(() =>
            taskService.deliverNativeTask(full, harnessSessionId, (delivered) => {
              onTaskDelivered?.(delivered);
              deliveryState.clearNativeNudgeFailures(delivered.chatroomId, delivered.role);
              console.log(
                `[NativeDelivery:execution] attempt=${attemptId} role=${delivered.role} chatroom=${delivered.chatroomId} task=${delivered.taskId} operation=inject result=success`
              );
            })
          );
        }).pipe(
          Effect.provide(effectContext),
          Effect.catchAll((err) =>
            Effect.sync(() =>
              console.warn(
                `[NativeDelivery:failure] role=${row.agentConfig.role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject error=${getErrorMessage(err)}`
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
// fallow-ignore-file complexity
