import type {
  AssignedTaskSnapshotView,
  SessionAugmentationMode,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  explainAgentReadyForNativeDeliveryBlock,
  isDeliverableNativeTaskStatus,
} from './native-ready-invariant.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should deliver a task into a live native harness session. */
// fallow-ignore-next-line unused-export
export function shouldDeliverNativeTask(
  task: AssignedTaskSnapshotView,
  opts: { slot: AgentSlot | undefined }
): boolean {
  return explainNativeDeliveryBlock(task, opts) === null;
}

/** Human-readable reason when delivery is blocked; null when shouldDeliverNativeTask is true. */
// fallow-ignore-next-line complexity
export function explainNativeDeliveryBlock(
  task: AssignedTaskSnapshotView,
  opts: { slot: AgentSlot | undefined }
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
  return explainAgentReadyForNativeDeliveryBlock(task, opts.slot);
}

const AUGMENTATION_PREAMBLES: Partial<Record<SessionAugmentationMode, string>> = {
  compact:
    '⚠️ Context was compacted. Run `chatroom get-system-prompt` only if role instructions are missing.',
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
