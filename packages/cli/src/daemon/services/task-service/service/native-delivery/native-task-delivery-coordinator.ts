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
import { TaskAssigneeType, type AssignedTask } from '../../../../domain/entities/assigned-task.js';
import type {
  AgentConfigEntry,
  AgentConfigRegistry,
} from '../../../chatroom-workspace-configuration-service/index.js';

export type NativeDeliveryDelivered = {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
};

export type NativeDeliveryExecution =
  | { kind: 'delivered'; delivered: NativeDeliveryDelivered }
  | { kind: 'task-unavailable'; stale?: boolean }
  | { kind: 'failed'; reason: 'injection_not_confirmed' };

export type NativeDeliveryExecutors = {
  deliverTask: (
    task: AssignedTask,
    agentConfig: AgentConfigEntry | undefined
  ) => Promise<NativeDeliveryExecution>;
};

async function recordDeliveryFailure(
  taskService: TaskDeliveryService,
  taskId: string,
  reason:
    | 'no_agent_config'
    | 'unsupported_harness'
    | 'injection_not_confirmed'
    | 'task_not_deliverable'
    | 'assigned_elsewhere'
): Promise<void> {
  try {
    await taskService.recordDeliveryFailure({ taskId, reason });
  } catch (error) {
    console.warn(
      `[NativeDelivery:failure] task=${taskId} operation=record-failure error=${getErrorMessage(error)}`
    );
  }
}

export type DeliveryPass =
  | 'inbox-event'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'agent-started'
  | 'agent-session-lost'
  | 'turn-ended'
  | 'restart-completed';

// fallow-ignore-next-line unused-export
export class NativeTaskDeliveryCoordinator {
  resetRoleDeliveryState(chatroomId: string, role: string): void {
    getRoleDeliveryState().resetDeliveryState(chatroomId, role);
  }

  // fallow-ignore-next-line complexity
  async reconcileRoleTasks(params: {
    tasks: AssignedTask[];
    pass?: DeliveryPass;
    taskService: TaskDeliveryService;
    configurationService: AgentConfigRegistry;
    isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean;
    onTaskDelivered?:
      | ((args: {
          chatroomId: string;
          role: string;
          taskId: string;
          harnessSessionId: string;
        }) => void)
      | undefined;
    executors: NativeDeliveryExecutors;
  }): Promise<readonly string[]> {
    const tasks = params.tasks;
    if (tasks.length === 0) return [];
    const deliveredTaskIds: string[] = [];
    const { isTaskActive, onTaskDelivered, executors } = params;
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
      const ephemeralConfig =
        firstTask.assignee?.type === TaskAssigneeType.Ephemeral
          ? firstTask.assignee.ephemeral
          : undefined;
      const agentConfig =
        params.configurationService.get(firstTask.chatroomId, role) ?? ephemeralConfig;
      const configState =
        params.configurationService.state?.(firstTask.chatroomId, role) ??
        (agentConfig ? 'ready' : 'syncing');
      const activeTaskId = roleTasks.find((candidate) =>
        isTaskActive({ chatroomId: candidate.chatroomId, role, taskId: candidate.taskId })
      )?.taskId;
      const decision = decideNextDelivery(roleTasks, {
        role,
        activeTaskId,
        agentConfig,
        configState,
        isNativeHarness: taskService.isNativeHarness,
        explainNativeDeliveryBlock: taskService.explainNativeDeliveryBlock,
        isRedeliveryExhausted: (taskId) =>
          taskService.isRedeliveryExhausted({ chatroomId: firstTask.chatroomId, role, taskId }),
      });
      const attemptId = `${Date.now()}-${firstTask.taskId}`;
      const decisionReason = 'reason' in decision ? decision.reason : undefined;
      logNativeDeliveryDecision(
        params.pass ?? 'inbox-event',
        role,
        firstTask.chatroomId,
        decision.kind === 'failed' || decision.kind === 'waiting'
          ? `${decision.kind}:${decision.reason}`
          : decision.kind,
        'taskId' in decision ? decision.taskId : undefined,
        { ...(decisionReason ? { reason: decisionReason } : {}), attemptId }
      );

      const row =
        ('taskId' in decision
          ? sortedTasks.find((candidate) => candidate.taskId === decision.taskId)
          : firstTask) ?? firstTask;

      if (decision.kind === 'idle' || decision.kind === 'waiting') {
        continue;
      }
      if (decision.kind === 'failed') {
        logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        await recordDeliveryFailure(taskService, decision.taskId, decision.reason);
        continue;
      }
      if (decision.kind === 'deduplicated') {
        logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        continue;
      }
      if (!deliveryState.tryAcquireDelivery(row.chatroomId, role)) {
        logNativeDeliveryMutexSkip(role, row.chatroomId, row.taskId);
        continue;
      }

      logNativeDeliveryInjecting(role, row.chatroomId, row.taskId);
      try {
        const result = await executors.deliverTask(row, agentConfig);
        if (!result || result.kind === 'task-unavailable') {
          console.warn(
            `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=task_hydration_missing`
          );
          if (!result?.stale) {
            await recordDeliveryFailure(taskService, row.taskId, 'injection_not_confirmed');
          }
        } else if (result.kind === 'failed') {
          console.warn(
            `[NativeDelivery:failure] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject reason=${result.reason}`
          );
          await recordDeliveryFailure(taskService, row.taskId, result.reason);
        } else {
          try {
            await taskService.clearDeliveryFailure(row.taskId);
          } catch (error) {
            console.warn(
              `[NativeDelivery:failure] task=${row.taskId} operation=clear-failure error=${getErrorMessage(error)}`
            );
          }
          onTaskDelivered?.(result.delivered);
          deliveredTaskIds.push(row.taskId);
          console.log(
            `[NativeDelivery:execution] attempt=${attemptId} role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject result=success`
          );
        }
      } catch (error) {
        console.warn(
          `[NativeDelivery:failure] role=${role} chatroom=${row.chatroomId} task=${row.taskId} operation=inject error=${getErrorMessage(error)}`
        );
        await recordDeliveryFailure(taskService, row.taskId, 'injection_not_confirmed');
      } finally {
        deliveryState.releaseDelivery(row.chatroomId, role);
      }
    }
    return deliveredTaskIds;
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
