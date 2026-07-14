import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { isAgentDesiredRunning } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import { isAgentReadyForNativeDelivery } from './native-ready-invariant.js';
import { isNativeHarness } from './native-task-injector-logic.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../../domain/agent-lifecycle/predicates/agent-slot.js';
import {
  isCliIdleNotListening,
  isStaleCliGetNextTaskWaiting,
} from '../../../domain/native-integration/predicates.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import { STOPPING_TIMEOUT_MS } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

const PENDING_IDLE_NUDGE_MS = 15_000;
const NUDGE_COOLDOWN_MS = 60_000;
const NATIVE_NUDGE_ESCALATION_THRESHOLD = 2;

function isPendingAliveRunningTask(task: AssignedTaskSnapshotView): boolean {
  const { agentConfig, status } = task;
  return (
    status === 'pending' &&
    agentConfig.spawnedAgentPid != null &&
    isAgentDesiredRunning(agentConfig.desiredState)
  );
}

export interface NativeAgentLocalHealth {
  getSlot: (chatroomId: string, role: string) => AgentSlot | undefined;
  isPidAlive: (pid: number) => boolean;
}

// fallow-ignore-next-line complexity
function isSlotUnavailableForPid(
  slot: AgentSlot | undefined,
  pid: number,
  isPidAlive: (pid: number) => boolean,
  now = Date.now()
): boolean {
  if (!slot) {
    return true;
  }
  if (isSlotIdle(slot.state)) {
    return true;
  }
  if (isSlotStopping(slot.state)) {
    // Hung stop (or unknown age) — treat as down so revive can proceed
    if (!slot.stoppingSince || now - slot.stoppingSince >= STOPPING_TIMEOUT_MS) {
      return true;
    }
    return false;
  }
  if (slot.pid !== pid) {
    return true;
  }
  return !isPidAlive(pid);
}

function isNativeRevivableTaskStatus(task: AssignedTaskSnapshotView): boolean {
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
function isNativeAgentSlotDown(
  task: AssignedTaskSnapshotView,
  health: NativeAgentLocalHealth,
  now = Date.now()
): boolean {
  const slot = health.getSlot(task.chatroomId, task.agentConfig.role);
  if (slot && isSlotSpawning(slot.state)) return false;

  const pid = task.agentConfig.spawnedAgentPid ?? slot?.pid;
  if (pid == null) {
    return slot?.state !== 'running';
  }

  return isSlotUnavailableForPid(slot, pid, health.isPidAlive, now);
}

/** Native agent should be running for an active task but the local slot is down. */
function isNativeActiveTaskAgentDown(
  task: AssignedTaskSnapshotView,
  health: NativeAgentLocalHealth,
  now: number
): boolean {
  if (!isNativeHarness(task.agentConfig.agentHarness)) return false;
  if (!isAgentDesiredRunning(task.agentConfig.desiredState)) return false;
  if (!isNativeRevivableTaskStatus(task)) return false;
  return isNativeAgentSlotDown(task, health, now);
}

export function listNativeTasksNeedingRevive(
  tasks: AssignedTaskSnapshotView[],
  health: NativeAgentLocalHealth,
  now: number,
  cooldown: NudgeCooldown
): AssignedTaskSnapshotView[] {
  return tasks.filter((task) => {
    if (!isNativeActiveTaskAgentDown(task, health, now)) return false;
    const { chatroomId, agentConfig } = task;
    if (!agentConfig.workingDir) return false;
    if (!cooldown.canNudge(chatroomId, agentConfig.role, now)) return false;
    cooldown.recordNudge(chatroomId, agentConfig.role, now);
    return true;
  });
}

function shouldNudgeCliPendingTask(
  task: AssignedTaskSnapshotView,
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
  task: AssignedTaskSnapshotView,
  now: number,
  pendingIdleThresholdMs = PENDING_IDLE_NUDGE_MS
): boolean {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    return shouldNudgeNativePendingTask(task, now, pendingIdleThresholdMs);
  }
  return shouldNudgeCliPendingTask(task, now, pendingIdleThresholdMs);
}

function shouldNudgeNativePendingTask(
  task: AssignedTaskSnapshotView,
  now: number,
  pendingIdleThresholdMs: number,
  slot?: AgentSlot
): boolean {
  if (!isPendingAliveRunningTask(task)) return false;
  if (!isAgentReadyForNativeDelivery(task, slot)) return false;
  const lastSeenAt = task.participant?.lastSeenAt ?? 0;
  const idleSince = lastSeenAt > 0 ? now - lastSeenAt : now - task.createdAt;
  return idleSince > pendingIdleThresholdMs;
}

export function shouldEscalateNativeNudgeToRestart(
  chatroomId: string,
  role: string,
  failures: number
): boolean {
  return failures >= NATIVE_NUDGE_ESCALATION_THRESHOLD;
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
  task: AssignedTaskSnapshotView,
  now: number,
  cooldown: NudgeCooldown,
  getSlot?: (chatroomId: string, role: string) => AgentSlot | undefined
): boolean {
  if (isNativeHarness(task.agentConfig.agentHarness)) {
    const slot = getSlot?.(task.chatroomId, task.agentConfig.role);
    if (!shouldNudgeNativePendingTask(task, now, PENDING_IDLE_NUDGE_MS, slot)) return false;
  } else if (!shouldNudgePendingTask(task, now)) {
    return false;
  }
  const { chatroomId, agentConfig } = task;
  if (!cooldown.canNudge(chatroomId, agentConfig.role, now)) return false;
  if (!agentConfig.workingDir) return false;
  return true;
}

export function listTasksReadyForNudge(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: NudgeCooldown,
  getSlot?: (chatroomId: string, role: string) => AgentSlot | undefined
): AssignedTaskSnapshotView[] {
  return tasks.filter((task) => {
    if (!isTaskReadyForNudge(task, now, cooldown, getSlot)) return false;
    cooldown.recordNudge(task.chatroomId, task.agentConfig.role, now);
    return true;
  });
}
