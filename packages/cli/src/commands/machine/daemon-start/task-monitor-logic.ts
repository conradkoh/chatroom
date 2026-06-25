import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import { isNativeHarness } from './native-task-injector-logic.js';
import {
  isCliIdleNotListening,
  isStaleCliGetNextTaskWaiting,
} from '../../../domain/native-integration/predicates.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

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

export interface NativeAgentLocalHealth {
  getSlot: (chatroomId: string, role: string) => AgentSlot | undefined;
  isPidAlive: (pid: number) => boolean;
}

function isSlotUnavailableForPid(
  slot: AgentSlot | undefined,
  pid: number,
  isPidAlive: (pid: number) => boolean
): boolean {
  if (!slot || slot.state === 'idle' || slot.state === 'stopping') {
    return true;
  }
  if (slot.pid !== pid) {
    return true;
  }
  return !isPidAlive(pid);
}

function isNativeRevivableTaskStatus(task: AssignedTaskView): boolean {
  const { status } = task;
  if (status === 'pending') {
    return task.agentConfig.spawnedAgentPid != null;
  }
  if (status === 'acknowledged') {
    return task.assignedTo?.toLowerCase() === task.agentConfig.role.toLowerCase();
  }
  return false;
}

// fallow-ignore-next-line complexity
function isNativeAgentSlotDown(task: AssignedTaskView, health: NativeAgentLocalHealth): boolean {
  const slot = health.getSlot(task.chatroomId, task.agentConfig.role);
  if (slot?.state === 'spawning') return false;

  const pid = task.agentConfig.spawnedAgentPid ?? slot?.pid;
  if (pid == null) {
    return slot?.state !== 'running';
  }

  return isSlotUnavailableForPid(slot, pid, health.isPidAlive);
}

/** Native agent should be running for an active task but the local slot is down. */
function isNativeActiveTaskAgentDown(
  task: AssignedTaskView,
  health: NativeAgentLocalHealth
): boolean {
  if (!isNativeHarness(task.agentConfig.agentHarness)) return false;
  if (task.agentConfig.desiredState !== 'running') return false;
  if (!isNativeRevivableTaskStatus(task)) return false;
  return isNativeAgentSlotDown(task, health);
}

export function listNativeTasksNeedingRevive(
  tasks: AssignedTaskView[],
  health: NativeAgentLocalHealth,
  now: number,
  cooldown: NudgeCooldown
): AssignedTaskView[] {
  return tasks.filter((task) => {
    if (!isNativeActiveTaskAgentDown(task, health)) return false;
    const { chatroomId, agentConfig } = task;
    if (!agentConfig.workingDir) return false;
    if (!cooldown.canNudge(chatroomId, agentConfig.role, now)) return false;
    cooldown.recordNudge(chatroomId, agentConfig.role, now);
    return true;
  });
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

/** Returns true when a pending CLI task should trigger an agent restart nudge. */
function shouldNudgePendingTask(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs = PENDING_IDLE_NUDGE_MS
): boolean {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    return false;
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
  if (!agentConfig.workingDir) return false;
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
