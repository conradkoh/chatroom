import {
  type AssignedTask,
  isDeliverableTaskStatus,
} from '../../../../domain/entities/assigned-task.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../../../domain/usecase/check-agent-slot.js';
import type { AgentProcessSlotView } from '../../../agent-process-contracts.js';
import type { AgentConfigEntry } from '../../../chatroom-workspace-configuration-service/index.js';
import type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';

export type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';

export type DeliveryWaitReason =
  | 'slot_spawning'
  | 'slot_stopping'
  | 'agent_start_in_flight'
  | 'session_not_ready'
  | 'turn_not_idle';

export type DeliveryDecision =
  | { kind: 'idle'; reason: 'no_deliverable_task' | 'not_assigned'; taskId?: string }
  | { kind: 'blocked'; reason: DeliveryBlockReason; taskId: string }
  | { kind: 'start-agent'; taskId: string }
  | { kind: 'wait'; reason: DeliveryWaitReason; taskId: string }
  | { kind: 'inject'; taskId: string; harnessSessionId?: string | undefined }
  | {
      kind: 'deduplicated';
      taskId: string;
      reason: 'task_state_active' | 'delivery_in_flight';
    };

export type DeliveryDecisionContext = {
  role: string;
  slot: AgentProcessSlotView | undefined;
  activeTaskId: string | undefined;
  deliveryInFlight: boolean;
  /** Configuration resolved from ChatroomWorkspaceConfigurationService. */
  agentConfig: AgentConfigEntry | undefined;
  agentLifecycleInFlight: boolean;
  isNativeHarness: (harness: string) => boolean;
  taskRequestsNativeColdSession: (task: AssignedTask) => boolean;
  explainNativeDeliveryBlock: (
    task: AssignedTask,
    options: {
      slot: AgentProcessSlotView | undefined;
      agentConfig: AgentConfigEntry | undefined;
    }
  ) => DeliveryBlockReason | null;
};

function taskSort(a: AssignedTask, b: AssignedTask): number {
  const pendingOrder = Number(b.status === 'pending') - Number(a.status === 'pending');
  return pendingOrder || a.createdAt - b.createdAt;
}

/**
 * Purely evaluates the next action for one role. It does not read Convex,
 * start processes, inject prompts, mutate task state, or acquire locks.
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
      return {
        kind: 'blocked',
        taskId: assignedTasks[0].taskId,
        reason: 'task_status_not_deliverable',
      };
    }
    return { kind: 'idle', reason: tasks.length > 0 ? 'not_assigned' : 'no_deliverable_task' };
  }
  if (context.activeTaskId === task.taskId) {
    return { kind: 'deduplicated', taskId: task.taskId, reason: 'task_state_active' };
  }
  if (context.deliveryInFlight) {
    return { kind: 'deduplicated', taskId: task.taskId, reason: 'delivery_in_flight' };
  }

  const agentConfig = context.agentConfig;
  if (!agentConfig) {
    return { kind: 'blocked', taskId: task.taskId, reason: 'agent_config_missing' };
  }
  if (!context.isNativeHarness(agentConfig.agentHarness)) {
    return { kind: 'blocked', taskId: task.taskId, reason: 'not_native_harness' };
  }

  if (context.agentLifecycleInFlight) {
    return { kind: 'wait', taskId: task.taskId, reason: 'agent_start_in_flight' };
  }

  const blockReason = context.explainNativeDeliveryBlock(task, {
    slot: context.slot,
    agentConfig,
  });
  if (blockReason === null) {
    return {
      kind: 'inject',
      taskId: task.taskId,
      harnessSessionId: context.slot?.harnessSessionId,
    };
  }

  if (isSlotSpawning(context.slot?.state ?? 'idle')) {
    return { kind: 'wait', taskId: task.taskId, reason: 'slot_spawning' };
  }
  if (isSlotStopping(context.slot?.state ?? 'idle')) {
    return { kind: 'wait', taskId: task.taskId, reason: 'slot_stopping' };
  }

  const coldSession = context.taskRequestsNativeColdSession(task);
  const startAllowed = blockReason === 'slot_missing' || blockReason === 'slot_not_running';
  if (
    startAllowed &&
    !coldSession &&
    task.status === 'pending' &&
    isSlotIdle(context.slot?.state ?? 'idle') &&
    agentConfig.workingDir
  ) {
    return { kind: 'start-agent', taskId: task.taskId };
  }

  if (blockReason === 'harness_session_missing') {
    return { kind: 'wait', taskId: task.taskId, reason: 'session_not_ready' };
  }
  if (blockReason === 'turn_not_idle') {
    return { kind: 'wait', taskId: task.taskId, reason: 'turn_not_idle' };
  }

  return { kind: 'blocked', taskId: task.taskId, reason: blockReason };
}
