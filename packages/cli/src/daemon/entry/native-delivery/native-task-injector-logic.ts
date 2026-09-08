import type { SessionAugmentationMode } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  explainAgentReadyForNativeDeliveryBlock,
  isDeliverableNativeTaskStatus,
} from './native-ready-invariant.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import type { MachineAgentOperationalRow } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentSlot } from '../../services/agent-process-service/index.js';

export { isNativeHarness } from '../../domain/native-integration/index.js';

/**
 * Readiness inputs for native delivery gating. Callers with an explicit
 * operational read model should pass the row directly; legacy callers omit it
 * and fall back to the delivery-session registry lookup.
 */
export type NativeDeliveryReadinessOptions = {
  slot: AgentSlot | undefined;
  operational?: MachineAgentOperationalRow | undefined;
};

/** True when daemon should deliver a task into a live native harness session. */
// fallow-ignore-next-line unused-export
export function shouldDeliverNativeTask(
  task: AssignedTaskSnapshotView,
  opts: NativeDeliveryReadinessOptions
): boolean {
  return explainNativeDeliveryBlock(task, opts) === null;
}

/** Human-readable reason when delivery is blocked; null when shouldDeliverNativeTask is true. */
// fallow-ignore-next-line complexity
export function explainNativeDeliveryBlock(
  task: AssignedTaskSnapshotView,
  opts: NativeDeliveryReadinessOptions
): string | null {
  if (!isDeliverableNativeTaskStatus(task.status)) {
    return `task_status_not_deliverable (status=${task.status})`;
  }
  if (task.status === 'acknowledged') {
    const assignedTo = task.assignedTo?.toLowerCase();
    const role = task.agentConfig.role.toLowerCase();
    if (assignedTo !== role) {
      return `acknowledged_wrong_role (assignedTo=${assignedTo ?? 'none'}, role=${role})`;
    }
  }
 return explainAgentReadyForNativeDeliveryBlock(task, opts.slot, opts.operational);
}

const AUGMENTATION_PREAMBLES: Partial<Record<SessionAugmentationMode, string>> = {
  new_session:
    '⚠️ Starting a new agent session. Run `chatroom get-system-prompt` to reload role instructions if needed.',
};

/** Shape injected prompt: task delivery body + optional augmentation preamble. */
export function buildNativeInjectionPrompt(params: {
  taskDeliveryOutput: string;
  augmentationMode: SessionAugmentationMode;
}): string {
  const preamble = AUGMENTATION_PREAMBLES[params.augmentationMode];
  if (!preamble) return params.taskDeliveryOutput;
  return [preamble, '', params.taskDeliveryOutput].join('\n');
}
