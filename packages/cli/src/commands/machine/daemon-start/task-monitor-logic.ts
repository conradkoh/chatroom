import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import { isNativeHarness, shouldNudgeNativeInjection } from './native-task-injector-logic.js';

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

function isIdleNotListening(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs: number
): boolean {
  const lastSeenAction = task.participant?.lastSeenAction;
  if (lastSeenAction === 'get-next-task:started' || lastSeenAction == null) {
    return false;
  }
  return now - task.createdAt > pendingIdleThresholdMs;
}

/** Returns true when a pending task should trigger an agent restart nudge. */
// fallow-ignore-next-line unused-export complexity
export function shouldNudgePendingTask(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs = PENDING_IDLE_NUDGE_MS
): boolean {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    return shouldNudgeNativeInjection(task, now, pendingIdleThresholdMs);
  }

  if (!isPendingAliveRunningTask(task)) return false;

  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  const staleWaiting =
    task.participant?.lastSeenAction === 'get-next-task:started' && task.createdAt > lastSeenAt;

  return staleWaiting || isIdleNotListening(task, now, pendingIdleThresholdMs);
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

// fallow-ignore-next-line complexity
export function listTasksReadyForNudge(
  tasks: AssignedTaskView[],
  now: number,
  cooldown: NudgeCooldown
): AssignedTaskView[] {
  const ready: AssignedTaskView[] = [];
  for (const task of tasks) {
    if (!shouldNudgePendingTask(task, now)) continue;
    const { chatroomId, agentConfig } = task;
    if (!cooldown.canNudge(chatroomId, agentConfig.role, now)) continue;
    if (!agentConfig.workingDir) continue;
    cooldown.recordNudge(chatroomId, agentConfig.role, now);
    ready.push(task);
  }
  return ready;
}
