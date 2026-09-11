import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import { Effect, Runtime, type Context } from 'effect';

import { decideNextDelivery } from './delivery-decision.js';
import {
  logNativeDeliveryDecision,
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliverySkip,
} from './native-delivery-log.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import type { TaskDeliveryService } from './task-delivery-service.js';
import { getErrorMessage } from '../../../../../utils/convex-error.js';
import type { AgentLifecycleFact } from '../../../../domain/entities/agent-lifecycle-fact.js';
import {
  resolveAgentRuntimeConfig,
  type AssignedTask,
} from '../../../../domain/entities/assigned-task.js';
import { isSlotIdle } from '../../../../domain/usecase/check-agent-slot.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../../entry/daemon-services.js';
import type { AgentHarness } from '../../../../entry/daemon-types.js';
import { isRestartOrchestratorInFlight } from '../../../../entry/restart-orchestrator-in-flight.js';
import type {
  AgentKey,
  SerializedAgentOperations,
  SerializedAgentOperationOptions,
  SerializedAgentOperationContext,
  NativeDeliverySessionHandles,
} from '../../../service-interfaces.js';

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
  startAgent: (task: AssignedTask) => Promise<unknown>;
  injectTask: (
    task: AssignedTask,
    harnessSessionId: string | undefined
  ) => Promise<NativeDeliveryExecution>;
};

type DeliveryPass =
  'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'restart' | 'agent-started';
type ExtendedDeliveryPass =
  DeliveryPass | 'agent-session-lost' | 'turn-ended' | 'restart-completed';
type LegacyDeliveryPass = 'inbox-signal' | 'restart';

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  async reconcileRoleTasks(params: {
    tasks: AssignedTask[];
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
    const { runtime, effectContext, agentMgr, isTaskActive, onTaskDelivered, executors } = params;
    const deliveryState = getRoleDeliveryState();
    const taskService = params.taskService;

    const groups = new Map<string, AssignedTask[]>();
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
      const runtimeConfig = resolveAgentRuntimeConfig(firstTask, slot);
      const activeTaskId = roleTasks.find((candidate) =>
        isTaskActive({ chatroomId: candidate.chatroomId, role, taskId: candidate.taskId })
      )?.taskId;
      const decision = decideNextDelivery(roleTasks, {
        role,
        slot,
        activeTaskId,
        deliveryInFlight: false,
        agentLifecycleInFlight: isRestartOrchestratorInFlight(firstTask.chatroomId, role),
        isNativeHarness: taskService.isNativeHarness,
        taskRequestsNativeColdSession: taskService.taskRequestsNativeColdSession,
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
        if (!runtimeConfig || (slot && !isSlotIdle(slot.state))) continue;
        try {
          if (executors) {
            const startResult = await executors.startAgent(row);
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
                  agentHarness: runtimeConfig.agentHarness as AgentHarness,
                  model: runtimeConfig.model ?? '',
                  workingDir: runtimeConfig.workingDir,
                  reason: AgentStartReasonEnum['platform.pending_task_wake'],
                  wantResume: false,
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
          const full = yield* Effect.tryPromise(() =>
            taskService.loadAssignedTaskForAction({
              chatroomId: row.chatroomId,
              role: row.agentConfig.role,
              taskId: row.taskId,
            })
          );

          if (!full) {
            console.warn(
              `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
            );
            return;
          }

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
