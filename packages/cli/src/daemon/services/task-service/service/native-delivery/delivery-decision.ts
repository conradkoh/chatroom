import {
  type AssignedTask,
  isDeliverableTaskStatus,
} from '../../../../domain/entities/assigned-task.js';
import type { AgentConfigEntry } from '../../../chatroom-workspace-configuration-service/index.js';
import type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';

export type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';

export type DeliveryDecision =
  | { kind: 'idle'; reason: 'no_deliverable_task' | 'not_assigned' }
  | {
      kind: 'waiting';
      reason: 'config_sync_lag' | 'agent_not_ready';
      taskId: string;
    }
  | {
      kind: 'failed';
      reason: 'unsupported_harness' | 'task_not_deliverable' | 'assigned_elsewhere';
      taskId: string;
    }
  | { kind: 'deliver'; taskId: string }
  | {
      kind: 'deduplicated';
      reason: 'task_state_active';
      taskId: string;
    };

export type DeliveryDecisionContext = {
  role: string;
  activeTaskId: string | undefined;
  /** Configuration resolved from ChatroomWorkspaceConfigurationService. */
  agentConfig: AgentConfigEntry | undefined;
  isNativeHarness: (harness: string) => boolean;
  explainNativeDeliveryBlock: (task: AssignedTask) => DeliveryBlockReason | null;
};

function taskSort(a: AssignedTask, b: AssignedTask): number {
  const pendingOrder = Number(b.status === 'pending') - Number(a.status === 'pending');
  return pendingOrder || a.createdAt - b.createdAt;
}

/**
 * Evaluates task-domain delivery policy. Agent-process slot state is owned by
 * acquireNativeDeliverySlot and is intentionally absent from this context.
 */
// fallow-ignore-next-line complexity
export function decideNextDelivery(
  tasks: readonly AssignedTask[],
  context: DeliveryDecisionContext
): DeliveryDecision {
  const assignedTasks = [...tasks]
    .filter((candidate) => candidate.agentConfig.role.toLowerCase() === context.role.toLowerCase())
    .sort(taskSort);
  const task = assignedTasks.find((candidate) => isDeliverableTaskStatus(candidate.status));

  if (!task) {
    if (assignedTasks.length > 0) {
      return { kind: 'failed', taskId: assignedTasks[0].taskId, reason: 'task_not_deliverable' };
    }
    return { kind: 'idle', reason: tasks.length > 0 ? 'not_assigned' : 'no_deliverable_task' };
  }
  if (context.activeTaskId === task.taskId) {
    return { kind: 'deduplicated', taskId: task.taskId, reason: 'task_state_active' };
  }
  if (
    task.status === 'acknowledged' &&
    task.assignedTo?.toLowerCase() !== context.role.toLowerCase()
  ) {
    return { kind: 'failed', taskId: task.taskId, reason: 'assigned_elsewhere' };
  }

  if (!context.agentConfig) {
    return { kind: 'waiting', taskId: task.taskId, reason: 'config_sync_lag' };
  }
  if (!context.isNativeHarness(context.agentConfig.agentHarness)) {
    return { kind: 'failed', taskId: task.taskId, reason: 'unsupported_harness' };
  }

  const blockReason = context.explainNativeDeliveryBlock(task);
  if (blockReason === 'task_status_not_deliverable') {
    return { kind: 'failed', taskId: task.taskId, reason: 'task_not_deliverable' };
  }
  if (blockReason === 'acknowledged_wrong_role') {
    return { kind: 'failed', taskId: task.taskId, reason: 'assigned_elsewhere' };
  }

  return { kind: 'deliver', taskId: task.taskId };
}
