import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

/** Pending, or acknowledged and owned by this agent — eligible for native task injection. */
// fallow-ignore-next-line complexity
export function isNativeInjectableAliveRunning(task: AssignedTaskSnapshotView): boolean {
  const { agentConfig, status } = task;
  if (!isNativeHarness(agentConfig.agentHarness)) return false;
  if (agentConfig.spawnedAgentPid == null || agentConfig.desiredState !== 'running') {
    return false;
  }
  if (status === 'pending') return true;
  if (status === 'acknowledged') {
    const assignedTo = task.assignedTo?.toLowerCase();
    return assignedTo === agentConfig.role.toLowerCase();
  }
  return false;
}

export function isInjectableNativeAction(action: string | null | undefined): boolean {
  if (action == null) return true;
  return action === NATIVE_WAITING_ACTION;
}

/** Harness turn-end is idle, but chatroom task may still be acknowledged or in progress. */
export function shouldEmitNativeWaitingOnTurnEnd(lastStatus: string | null | undefined): boolean {
  return lastStatus !== 'task.acknowledged' && lastStatus !== 'task.inProgress';
}

/** Missed native:waiting after handoff — task completed but action still task-injected. */
export function isNativeIdleAfterTaskComplete(participant: {
  lastSeenAction?: string | null;
  lastStatus?: string | null;
}): boolean {
  return (
    participant.lastSeenAction === NATIVE_TASK_INJECTED_ACTION &&
    participant.lastStatus === 'task.completed'
  );
}

/** Injection retry after claim/join when resume did not complete. */
export function isNativeAcknowledgedInjectionRetry(task: AssignedTaskSnapshotView): boolean {
  if (task.status !== 'acknowledged') return false;
  const assignedTo = task.assignedTo?.toLowerCase();
  if (assignedTo !== task.agentConfig.role.toLowerCase()) return false;
  return task.participant?.lastSeenAction === NATIVE_TASK_INJECTED_ACTION;
}

// fallow-ignore-next-line complexity
export function isStaleCliGetNextTaskWaiting(task: AssignedTaskSnapshotView): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  return (
    task.participant?.lastSeenAction === 'get-next-task:started' && task.createdAt > lastSeenAt
  );
}

export function isCliIdleNotListening(
  task: AssignedTaskSnapshotView,
  now: number,
  thresholdMs: number
): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  if (lastSeenAt === 0) return now - task.createdAt > thresholdMs;
  return now - lastSeenAt > thresholdMs;
}
