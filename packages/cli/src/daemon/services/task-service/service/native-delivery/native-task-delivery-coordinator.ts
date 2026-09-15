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
  { kind: 'delivered'; delivered?: NativeDeliveryDelivered } | { kind: 'task-unavailable' };

export type NativeDeliveryExecutors = {
  deliverTask: (
    task: AssignedTask,
    agentConfig: AgentConfigEntry | undefined
  ) => Promise<NativeDeliveryExecution>;
};

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
    /** Optional config snapshot from TaskService's periodic wakeup. */
    agentConfig?: AgentConfigEntry | undefined;
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
  }): Promise<boolean> {
    const tasks = params.tasks;
    if (tasks.length === 0) return false;
    let deliveredAny = false;
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
        params.agentConfig ??
        params.configurationService?.get(firstTask.chatroomId, role) ??
        // Legacy/test callers predate the configuration service. Production
        // always resolves configuration through that service.
        ephemeralConfig;
      const activeTaskId = roleTasks.find((candidate) =>
        isTaskActive({ chatroomId: candidate.chatroomId, role, taskId: candidate.taskId })
      )?.taskId;
      const decision = decideNextDelivery(roleTasks, {
        role,
        activeTaskId,
        agentConfig,
        isNativeHarness: taskService.isNativeHarness,
        explainNativeDeliveryBlock: taskService.explainNativeDeliveryBlock,
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

      if (decision.kind === 'idle' || decision.kind === 'failed' || decision.kind === 'waiting') {
        if (decision.kind !== 'idle') {
          logNativeDeliverySkip(role, row.chatroomId, decision.taskId, decision.reason);
        }
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
        } else if (result.delivered) {
          onTaskDelivered?.(result.delivered);
          deliveredAny = true;
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
    }
    return deliveredAny;
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
