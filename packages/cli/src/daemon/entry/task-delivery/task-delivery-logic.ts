import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../../daemon/domain/usecase/check-agent-slot.js';
import {
  isOperationalCircuitOpen,
  isOperationalDesiredRunning,
  isOperationalStopIntentActive,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentSlot } from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { STOPPING_TIMEOUT_MS } from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import { isChatroomStopScopeActive } from '../../infrastructure/agent-process-manager/execute-stop-targets-adapter.js';
import { snapshotRequestsNativeColdSession } from '../native-delivery/native-cold-session-delivery.js';
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

function roleKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}

function isCandidateDeliverableForOwnership(task: AssignedTaskSnapshotView): boolean {
  if (!isDeliverableTaskStatus(task.status)) return false;
  if (task.status === 'acknowledged') {
    return task.assignedTo?.toLowerCase() === task.agentConfig.role.toLowerCase();
  }
  return true;
}

/** Pending tasks sort before acknowledged ones; ties break by creation time. */
function comparePendingFirst(a: AssignedTaskSnapshotView, b: AssignedTaskSnapshotView): number {
  const pendingDelta = (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1);
  return pendingDelta !== 0 ? pendingDelta : a.createdAt - b.createdAt;
}

/**
 * Select the next delivery candidate per (chatroomId, role) in the same
 * pending-first/createdAt order delivery uses. An eligible cold owner
 * suppresses competing recovery for that role only.
 */
// fallow-ignore-next-line complexity
function selectNextCandidatePerRole(
  tasks: AssignedTaskSnapshotView[]
): Map<string, AssignedTaskSnapshotView> {
  const byRole = new Map<string, AssignedTaskSnapshotView[]>();
  for (const task of tasks) {
    if (!isCandidateDeliverableForOwnership(task)) continue;
    const key = roleKey(task.chatroomId, task.agentConfig.role);
    const list = byRole.get(key) ?? [];
    list.push(task);
    byRole.set(key, list);
  }
  const selected = new Map<string, AssignedTaskSnapshotView>();
  for (const [key, list] of byRole) {
    const first = [...list].sort(comparePendingFirst)[0];
    if (first) selected.set(key, first);
  }
  return selected;
}

/**
 * Roles whose selected candidate owns a delivery cold start (explicit cold
 * intent + local slot down per existing health rules). Recovery must not
 * compete with delivery for these roles.
 */
// fallow-ignore-next-line complexity
function selectColdOwnedRoles(
  tasks: AssignedTaskSnapshotView[],
  health: NativeAgentLocalHealth,
  now: number
): Set<string> {
  const owned = new Set<string>();
  for (const [key, candidate] of selectNextCandidatePerRole(tasks)) {
    if (!isNativeHarness(candidate.agentConfig.agentHarness)) continue;
    if (!snapshotRequestsNativeColdSession(candidate)) continue;
    if (!isNativeAgentSlotDown(candidate, health, now)) continue;
    owned.add(key);
  }
  return owned;
}

/** Native agent should be running for an active task but the local slot is down. */
// fallow-ignore-next-line complexity
function isNativeActiveTaskAgentDown(
  task: AssignedTaskSnapshotView,
  health: NativeAgentLocalHealth,
  now: number,
  coldOwnedRoles?: Set<string> | undefined
): boolean {
  if (!isNativeHarness(task.agentConfig.agentHarness)) return false;
  if (coldOwnedRoles?.has(roleKey(task.chatroomId, task.agentConfig.role))) return false;
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
  const coldOwnedRoles = selectColdOwnedRoles(tasks, health, now);
  return tasks.filter((task) => {
    if (!isNativeActiveTaskAgentDown(task, health, now, coldOwnedRoles)) return false;
    const { chatroomId, agentConfig } = task;
    if (!agentConfig.workingDir) return false;
    if (!cooldown.canAttempt(chatroomId, agentConfig.role, 'revive', now)) return false;
    cooldown.recordAttempt(chatroomId, agentConfig.role, 'revive', now);
    return true;
  });
}

/** Pending native task assigned to this machine whose backend agent is stopped. */
// fallow-ignore-next-line complexity
function isNativePendingTaskNeedingWake(
  task: AssignedTaskSnapshotView,
  coldOwnedRoles?: Set<string> | undefined
): boolean {
  if (!isNativeHarness(task.agentConfig.agentHarness)) return false;
  if (task.status !== 'pending') return false;
  if (snapshotRequestsNativeColdSession(task)) return false;
  if (coldOwnedRoles?.has(roleKey(task.chatroomId, task.agentConfig.role))) return false;
  if (isChatroomStopScopeActive(task.chatroomId)) return false;
  const op = getNativeDeliverySession()?.agentOperationalReadModel?.get(
    task.chatroomId,
    task.agentConfig.role
  );
  if (isOperationalDesiredRunning(op)) return false;
  // A failed start opens the circuit. Do not let the still-pending task
  // immediately re-trigger the same failing spawn; manual start or a fresh
  // lifecycle transition must close/re-authorize the circuit first.
  if (isOperationalCircuitOpen(op)) return false;
  if (isOperationalStopIntentActive(op)) return false;
  return Boolean(task.agentConfig.workingDir);
}

// fallow-ignore-next-line complexity
export function listNativePendingTasksNeedingWake(
  tasks: AssignedTaskSnapshotView[],
  cooldown: RecoveryCooldown,
  now: number
): AssignedTaskSnapshotView[] {
  // Suppress wake for a role whose selected candidate owns a cold start, so a
  // continue-session row queued behind an explicit cold task cannot revive
  // ahead of delivery. Uses slot-agnostic candidate intent (wake applies when
  // operational is stopped/missing).
  const coldOwnedRoles = new Set<string>();
  for (const [key, candidate] of selectNextCandidatePerRole(tasks)) {
    if (
      candidate.status === 'pending' &&
      isNativeHarness(candidate.agentConfig.agentHarness) &&
      snapshotRequestsNativeColdSession(candidate)
    ) {
      coldOwnedRoles.add(key);
    }
  }
  return tasks.filter((task) => {
    if (!isNativePendingTaskNeedingWake(task, coldOwnedRoles)) return false;
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
