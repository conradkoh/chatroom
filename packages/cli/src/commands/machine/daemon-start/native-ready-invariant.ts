import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

/** Agent is ready for native task delivery (post-restart or steady-state). */
export function isAgentReadyForNativeDelivery(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined
): boolean {
  return explainAgentReadyForNativeDeliveryBlock(task, slot) === null;
}

/** Human-readable reason when agent/slot is not ready; null when ready. */
// fallow-ignore-next-line complexity
export function explainAgentReadyForNativeDeliveryBlock(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined
): string | null {
  const { agentConfig } = task;
  if (!isNativeHarness(agentConfig.agentHarness)) {
    return `not_native_harness (harness=${agentConfig.agentHarness})`;
  }
  if (agentConfig.desiredState !== 'running') {
    return `desired_state_not_running (desiredState=${agentConfig.desiredState})`;
  }
  if (agentConfig.spawnedAgentPid == null) {
    return 'spawned_pid_missing';
  }
  if (!slot) {
    return `slot_missing (expectedPid=${agentConfig.spawnedAgentPid})`;
  }
  if (slot.state !== 'running') {
    return `slot_not_running (slotState=${slot.state}, expectedPid=${agentConfig.spawnedAgentPid})`;
  }
  if (slot.pid !== agentConfig.spawnedAgentPid) {
    return `pid_mismatch (slotPid=${slot.pid ?? 'none'}, snapshotPid=${agentConfig.spawnedAgentPid})`;
  }
  if (typeof slot.harnessSessionId !== 'string' || slot.harnessSessionId.length === 0) {
    return 'harness_session_missing';
  }
  const turnPhase = slot.nativeTurnPhase ?? 'idle';
  if (turnPhase !== 'idle') {
    return `turn_not_idle (nativeTurnPhase=${turnPhase})`;
  }
  return null;
}

/** Pending or acknowledged tasks eligible for (re)delivery when agent is ready. */
export function isDeliverableNativeTaskStatus(status: AssignedTaskSnapshotView['status']): boolean {
  return status === 'pending' || status === 'acknowledged';
}
