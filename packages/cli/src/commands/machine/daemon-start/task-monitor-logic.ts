import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import { isNativeHarness, shouldNudgeNativeInjection } from './native-task-injector-logic.js';
import {
  isCliIdleNotListening,
  isStaleCliGetNextTaskWaiting,
} from '../../../domain/native-integration/predicates.js';

const PENDING_IDLE_NUDGE_MS = 15_000;
const NUDGE_COOLDOWN_MS = 60_000;

function isPendingAliveRunningTask(task: AssignedTaskView): boolean {
  const { agentConfig, status } = task;
  return (
    status === 'pending' &&
    agentConfig.spawnedAgentPid != null &&
    agentConfig.desiredState === 'running'
  );
}

function shouldNudgeCliPendingTask(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs: number
): boolean {
  if (!isPendingAliveRunningTask(task)) return false;
  return (
    isStaleCliGetNextTaskWaiting(task) || isCliIdleNotListening(task, now, pendingIdleThresholdMs)
  );
}

/** Returns true when a pending task should trigger an agent restart nudge. */
function shouldNudgePendingTask(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs = PENDING_IDLE_NUDGE_MS
): boolean {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    return shouldNudgeNativeInjection(task, now, pendingIdleThresholdMs);
  }
  return shouldNudgeCliPendingTask(task, now, pendingIdleThresholdMs);
}

export class NudgeCooldown {
  private readonly lastNudgedAt = new Map<string, number>();

  constructor(private readonly cooldownMs = NUDGE_COOLDOWN_MS) {}

  canNudge(chatroomId: string, role: string, now: number): boolean {
    const key = `${chatroomId}:${role}`;
    const last = this.lastNudgedAt.get(key);
    return last === undefined || now - last >= this.cooldownMs;
  }

  recordNudge(chatroomId: string, role: string, now: number): void {
    this.lastNudgedAt.set(`${chatroomId}:${role}`, now);
  }
}

function isTaskReadyForNudge(
  task: AssignedTaskView,
  now: number,
  cooldown: NudgeCooldown
): boolean {
  if (!shouldNudgePendingTask(task, now)) return false;
  const { chatroomId, agentConfig } = task;
  if (!cooldown.canNudge(chatroomId, agentConfig.role, now)) return false;
  if (!isNativeHarness(agentConfig.agentHarness) && !agentConfig.workingDir) return false;
  return true;
}

export function listTasksReadyForNudge(
  tasks: AssignedTaskView[],
  now: number,
  cooldown: NudgeCooldown
): AssignedTaskView[] {
  return tasks.filter((task) => {
    if (!isTaskReadyForNudge(task, now, cooldown)) return false;
    cooldown.recordNudge(task.chatroomId, task.agentConfig.role, now);
    return true;
  });
}
