import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';

import {
  explainColdSessionDeliveryBlock,
  isNativeColdSessionDeliveryOwnedSpawn,
} from './native-cold-session-delivery.js';
import {
  resolveAgentRuntimeConfig,
  type AssignedTaskSnapshotView,
} from '../../../../domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../../domain/entities/assigned-task.js';
import { isSlotRunning, isTurnPhaseIdle } from '../../../../domain/usecase/check-agent-slot.js';
import type { AgentProcessSlotView } from '../../../agent-process-contracts.js';

/** Agent is ready for native task delivery (post-restart or steady-state). */
// fallow-ignore-next-line unused-export
export function isAgentReadyForNativeDelivery(
  task: AssignedTaskSnapshotView,
  slot: AgentProcessSlotView | undefined
): boolean {
  return explainAgentReadyForNativeDeliveryBlock(task, slot) === null;
}

/** Human-readable reason when agent/slot is not ready; null when ready. */
// fallow-ignore-next-line complexity
export function explainAgentReadyForNativeDeliveryBlock(
  task: AssignedTaskSnapshotView,
  slot: AgentProcessSlotView | undefined
): string | null {
  const runtimeConfig = resolveAgentRuntimeConfig(task, slot);
  if (!runtimeConfig) return 'agent_config_missing';
  if (!isNativeHarness(runtimeConfig.agentHarness)) {
    return `not_native_harness (harness=${runtimeConfig.agentHarness})`;
  }
  // Explicit cold-session tasks: apply stop/circuit/transition guards first.
  // When the slot is down (missing/idle) and unblocked, delivery owns the
  // cold start and bypasses the running-slot gates below; a running slot
  // falls through so the injector can cold-replace the existing session.
  const coldBlock = explainColdSessionDeliveryBlock(task, slot);
  if (coldBlock) {
    return coldBlock;
  }
  if (isNativeColdSessionDeliveryOwnedSpawn(task, slot)) {
    return null;
  }
  if (!slot) {
    return task.agentConfig.spawnedAgentPid == null
      ? 'spawned_pid_missing'
      : `slot_missing (expectedPid=${task.agentConfig.spawnedAgentPid})`;
  }
  if (!isSlotRunning(slot.state)) {
    if (task.agentConfig.spawnedAgentPid != null && slot.pid !== task.agentConfig.spawnedAgentPid) {
      return `pid_mismatch (slotPid=${slot.pid ?? 'none'}, expectedPid=${task.agentConfig.spawnedAgentPid})`;
    }
    return `slot_not_running (slotState=${slot.state}, expectedPid=${task.agentConfig.spawnedAgentPid ?? 'none'})`;
  }
  if (slot.pid == null) {
    return 'slot_pid_missing';
  }
  // The backend PID can lag behind a successful local spawn. Once the local
  // slot is healthy, it is the authoritative process identity for delivery.
  // Snapshot PID can lag or remain stale after agent exit + re-spawn.
  if (typeof slot.harnessSessionId !== 'string' || slot.harnessSessionId.length === 0) {
    return 'harness_session_missing';
  }
  const turnPhase = slot.nativeTurnPhase ?? 'idle';
  if (!isTurnPhaseIdle(turnPhase)) {
    return `turn_not_idle (nativeTurnPhase=${turnPhase})`;
  }
  return null;
}

/** Pending or acknowledged tasks eligible for (re)delivery when agent is ready. */
export function isDeliverableNativeTaskStatus(status: AssignedTaskSnapshotView['status']): boolean {
  return isDeliverableTaskStatus(status);
}
