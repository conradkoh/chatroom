import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';

import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import {
  isDeliverableTaskStatus,
} from '../../../daemon/domain/entities/assigned-task.js';
import { isSlotRunning, isTurnPhaseIdle } from '../../../daemon/domain/usecase/check-agent-slot.js';
import type { AgentSlot } from '../../infrastructure/agent-process-manager/agent-process-manager.js';

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
  if (!slot) {
    return 'slot_missing';
  }
  if (!isSlotRunning(slot.state)) {
    return `slot_not_running (slotState=${slot.state})`;
  }
  if (!slot.pid) return 'slot_pid_missing';
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
