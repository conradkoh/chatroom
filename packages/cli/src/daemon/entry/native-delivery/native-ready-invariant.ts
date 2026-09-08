import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';

import {
  explainColdSessionDeliveryBlock,
  isNativeColdSessionDeliveryOwnedSpawn,
} from './native-cold-session-delivery.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../daemon/domain/entities/assigned-task.js';
import { isSlotRunning, isTurnPhaseIdle } from '../../../daemon/domain/usecase/check-agent-slot.js';
import {
  isOperationalDesiredRunning,
  type MachineAgentOperationalRow,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentProcessSlotView } from '../../services/agent-process-service/index.js';

/** Agent is ready for native task delivery (post-restart or steady-state). */
export function isAgentReadyForNativeDelivery(
  task: AssignedTaskSnapshotView,
  slot: AgentProcessSlotView | undefined,
  operational?: MachineAgentOperationalRow | undefined
): boolean {
  return explainAgentReadyForNativeDeliveryBlock(task, slot, operational) === null;
}

/** Human-readable reason when agent/slot is not ready; null when ready. */
// fallow-ignore-next-line complexity
export function explainAgentReadyForNativeDeliveryBlock(
  task: AssignedTaskSnapshotView,
  slot: AgentProcessSlotView | undefined,
  explicitOperational?: MachineAgentOperationalRow | undefined
): string | null {
  const { agentConfig } = task;
  if (!isNativeHarness(agentConfig.agentHarness)) {
    return `not_native_harness (harness=${agentConfig.agentHarness})`;
  }
  // Readiness is evaluated from the caller's explicit operational snapshot.
  // The delivery-session registry is intentionally not consulted here.
  const operational = explicitOperational;
  // Explicit cold-session tasks: apply stop/circuit/transition guards first.
  // When the slot is down (missing/idle) and unblocked, delivery owns the
  // cold start and bypasses the running-slot gates below; a running slot
  // falls through so the injector can cold-replace the existing session.
  const coldBlock = explainColdSessionDeliveryBlock(task, slot, operational);
  if (coldBlock) {
    return coldBlock;
  }
  if (isNativeColdSessionDeliveryOwnedSpawn(task, slot)) {
    return null;
  }
  if (!isOperationalDesiredRunning(operational)) {
    return `operational_state_not_running (state=${operational?.operationalState ?? 'missing'})`;
  }
  if (!slot) {
    return agentConfig.spawnedAgentPid == null
      ? 'spawned_pid_missing'
      : `slot_missing (expectedPid=${agentConfig.spawnedAgentPid})`;
  }
  if (!isSlotRunning(slot.state)) {
    if (agentConfig.spawnedAgentPid != null && slot.pid !== agentConfig.spawnedAgentPid) {
      return `pid_mismatch (slotPid=${slot.pid ?? 'none'}, snapshotPid=${agentConfig.spawnedAgentPid})`;
    }
    return `slot_not_running (slotState=${slot.state}, expectedPid=${agentConfig.spawnedAgentPid ?? 'none'})`;
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
