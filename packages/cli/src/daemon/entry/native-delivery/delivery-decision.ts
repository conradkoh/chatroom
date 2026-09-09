import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../domain/entities/assigned-task.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../domain/usecase/check-agent-slot.js';
import type { AgentProcessSlotView } from '../../services/agent-process-contracts.js';

type TaskOperationalAgent = {
  operationalState: 'running' | 'stopped' | 'starting' | 'circuit_open';
  stopState?: 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed' | undefined;
};

export type DeliveryBlockReason =
  | 'not_native_harness'
  | 'task_status_not_deliverable'
  | 'acknowledged_wrong_role'
  | 'chatroom_stop_scope_active'
  | 'operational_stop_intent_active'
  | 'operational_circuit_open'
  | 'operational_state_not_running'
  | 'slot_missing'
  | 'slot_not_running'
  | 'slot_pid_missing'
  | 'harness_session_missing'
  | 'turn_not_idle'
  | 'working_dir_missing';

export type DeliveryWaitReason =
  'slot_spawning' | 'slot_stopping' | 'agent_start_in_flight' | 'session_not_ready';

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
  operational: TaskOperationalAgent | undefined;
  activeTaskId: string | undefined;
  deliveryInFlight: boolean;
  isNativeHarness: (harness: string) => boolean;
  snapshotRequestsNativeColdSession: (task: AssignedTaskSnapshotView) => boolean;
  explainNativeDeliveryBlock: (
    task: AssignedTaskSnapshotView,
    options: {
      slot: AgentProcessSlotView | undefined;
      operational: TaskOperationalAgent | undefined;
    }
  ) => string | null;
};

function taskSort(a: AssignedTaskSnapshotView, b: AssignedTaskSnapshotView): number {
  const pendingOrder = Number(b.status === 'pending') - Number(a.status === 'pending');
  return pendingOrder || a.createdAt - b.createdAt;
}

function stableBlockReason(reason: string): DeliveryBlockReason {
  const reasons: DeliveryBlockReason[] = [
    'not_native_harness',
    'task_status_not_deliverable',
    'acknowledged_wrong_role',
    'chatroom_stop_scope_active',
    'operational_stop_intent_active',
    'operational_circuit_open',
    'operational_state_not_running',
    'slot_missing',
    'slot_not_running',
    'slot_pid_missing',
    'harness_session_missing',
    'turn_not_idle',
    'working_dir_missing',
  ];
  return reasons.find((candidate) => reason.startsWith(candidate)) ?? 'working_dir_missing';
}

/**
 * Purely evaluates the next action for one role. It does not read Convex,
 * start processes, inject prompts, mutate task state, or acquire locks.
 */
// fallow-ignore-next-line complexity
export function decideNextDelivery(
  tasks: readonly AssignedTaskSnapshotView[],
  context: DeliveryDecisionContext
): DeliveryDecision {
  const task = [...tasks]
    .filter((candidate) => candidate.agentConfig.role.toLowerCase() === context.role.toLowerCase())
    .sort(taskSort)
    .find((candidate) => isDeliverableTaskStatus(candidate.status));

  if (!task) return { kind: 'idle', reason: 'no_deliverable_task' };
  if (context.activeTaskId === task.taskId) {
    return { kind: 'deduplicated', taskId: task.taskId, reason: 'task_state_active' };
  }
  if (context.deliveryInFlight) {
    return { kind: 'deduplicated', taskId: task.taskId, reason: 'delivery_in_flight' };
  }

  if (!context.isNativeHarness(task.agentConfig.agentHarness)) {
    return { kind: 'blocked', taskId: task.taskId, reason: 'not_native_harness' };
  }

  const blockReason = context.explainNativeDeliveryBlock(task, {
    slot: context.slot,
    operational: context.operational,
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

  const coldSession = context.snapshotRequestsNativeColdSession(task);
  const startAllowed =
    blockReason.startsWith('slot_missing') || blockReason.startsWith('slot_not_running');
  if (
    startAllowed &&
    !coldSession &&
    task.status === 'pending' &&
    isSlotIdle(context.slot?.state ?? 'idle') &&
    task.agentConfig.workingDir
  ) {
    return { kind: 'start-agent', taskId: task.taskId };
  }

  if (blockReason.startsWith('harness_session_missing')) {
    return { kind: 'wait', taskId: task.taskId, reason: 'session_not_ready' };
  }

  return { kind: 'blocked', taskId: task.taskId, reason: stableBlockReason(blockReason) };
}
