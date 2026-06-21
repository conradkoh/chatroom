import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

export function isNativePendingAliveRunning(task: AssignedTaskView): boolean {
  const { agentConfig, status } = task;
  return (
    isNativeHarness(agentConfig.agentHarness) &&
    status === 'pending' &&
    agentConfig.spawnedAgentPid != null &&
    agentConfig.desiredState === 'running'
  );
}

export function isInjectableNativeAction(action: string | null | undefined): boolean {
  if (action == null) return true;
  return action === NATIVE_WAITING_ACTION;
}

export function isStaleNativeWaiting(
  task: AssignedTaskView,
  now: number,
  thresholdMs: number
): boolean {
  return (
    task.participant?.lastSeenAction === NATIVE_WAITING_ACTION && now - task.createdAt > thresholdMs
  );
}

export function isStuckAfterNativeInject(
  task: AssignedTaskView,
  now: number,
  thresholdMs: number
): boolean {
  const participant = task.participant;
  if (participant?.lastSeenAction !== NATIVE_TASK_INJECTED_ACTION) return false;
  if (participant.lastStatus !== 'task.acknowledged') return false;
  const lastSeenAt = participant.lastSeenAt ?? 0;
  return now - lastSeenAt > thresholdMs;
}

export function isStaleCliGetNextTaskWaiting(task: AssignedTaskView): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  return (
    task.participant?.lastSeenAction === 'get-next-task:started' && task.createdAt > lastSeenAt
  );
}

export function isCliIdleNotListening(
  task: AssignedTaskView,
  now: number,
  thresholdMs: number
): boolean {
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  if (lastSeenAt === 0) return now - task.createdAt > thresholdMs;
  return now - lastSeenAt > thresholdMs;
}
