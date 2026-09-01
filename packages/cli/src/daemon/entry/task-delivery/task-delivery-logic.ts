import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../../daemon/domain/usecase/check-agent-slot.js';
import {
  isOperationalDesiredRunning,
  isOperationalStopIntentActive,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentSlot } from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { STOPPING_TIMEOUT_MS } from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { isChatroomStopScopeActive } from '../../infrastructure/agent-process-manager/execute-stop-targets-adapter.js';
import { getNativeDeliverySession } from '../native-delivery/native-delivery-session-registry.js';
import { isNativeHarness } from '../native-delivery/native-task-injector-logic.js';

const RECOVERY_COOLDOWN_MS = 60_000;

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
    // A user stop clears the persisted PID. Starting the team sets desired
    // state back to running, so a pending task with no PID still needs local
    // process recovery before native delivery can proceed.
    return true;
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
  const op = getNativeDeliverySession()?.agentOperationalReadModel?.get(
    task.chatroomId,
    task.agentConfig.role
  );
  if (!isOperationalDesiredRunning(op)) return false;
  if (!isNativeRevivableTaskStatus(task)) return false;
  return isNativeAgentSlotDown(task, health, now);
}

export function listNativeTasksNeedingRevive(
  tasks: AssignedTaskSnapshotView[],
  health: NativeAgentLocalHealth,
  now: number,
  cooldown: RecoveryCooldown
): AssignedTaskSnapshotView[] {
  return tasks.filter((task) => {
    if (!isNativeActiveTaskAgentDown(task, health, now)) return false;
    const { chatroomId, agentConfig } = task;
    if (!agentConfig.workingDir) return false;
    if (!cooldown.canAttempt(chatroomId, agentConfig.role, 'revive', now)) return false;
    cooldown.recordAttempt(chatroomId, agentConfig.role, 'revive', now);
    return true;
  });
}

/** Pending native task assigned to this machine whose backend agent is stopped. */
function isNativePendingTaskNeedingWake(task: AssignedTaskSnapshotView): boolean {
  if (!isNativeHarness(task.agentConfig.agentHarness)) return false;
  if (task.status !== 'pending') return false;
  if (isChatroomStopScopeActive(task.chatroomId)) return false;
  const op = getNativeDeliverySession()?.agentOperationalReadModel?.get(
    task.chatroomId,
    task.agentConfig.role
  );
  if (isOperationalDesiredRunning(op)) return false;
  if (isOperationalStopIntentActive(op)) return false;
  return Boolean(task.agentConfig.workingDir);
}

export function listNativePendingTasksNeedingWake(
  tasks: AssignedTaskSnapshotView[],
  cooldown: RecoveryCooldown,
  now: number
): AssignedTaskSnapshotView[] {
  return tasks.filter((task) => {
    if (!isNativePendingTaskNeedingWake(task)) return false;
    const { chatroomId, agentConfig } = task;
    if (!cooldown.canAttempt(chatroomId, agentConfig.role, 'wake', now)) return false;
    cooldown.recordAttempt(chatroomId, agentConfig.role, 'wake', now);
    return true;
  });
}

export type RecoveryKind = 'wake' | 'revive';

export class RecoveryCooldown {
  private readonly lastAttemptAt = new Map<string, number>();

  constructor(private readonly cooldownMs = RECOVERY_COOLDOWN_MS) {}

  canAttempt(chatroomId: string, role: string, kind: RecoveryKind, now: number): boolean {
    const key = `${kind}:${chatroomId}:${role}`;
    const last = this.lastAttemptAt.get(key);
    return last === undefined || now - last >= this.cooldownMs;
  }

  recordAttempt(chatroomId: string, role: string, kind: RecoveryKind, now: number): void {
    this.lastAttemptAt.set(`${kind}:${chatroomId}:${role}`, now);
  }
}
