import type { SessionAugmentationMode } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { DeliveryBlockReason } from './native-delivery-reason.js';
import { isDeliverableTaskStatus } from '../../../../domain/entities/assigned-task.js';
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';

export { isNativeHarness } from '../../../../domain/native-integration/index.js';

/**
 * Readiness inputs for native delivery gating.
 */
/** Compatibility options; readiness no longer inspects process state. */
export type NativeDeliveryReadinessOptions = Record<string, unknown>;

/** True when daemon should deliver a task into a live native harness session. */
// fallow-ignore-next-line unused-export
export function shouldDeliverNativeTask(
  task: AssignedTask,
  opts: NativeDeliveryReadinessOptions
): boolean {
  return explainNativeDeliveryBlock(task, opts) === null;
}

/** Stable reason when delivery is blocked; null when shouldDeliverNativeTask is true. */
// fallow-ignore-next-line complexity
export function explainNativeDeliveryBlock(
  task: AssignedTask,
  _opts?: NativeDeliveryReadinessOptions
): DeliveryBlockReason | null {
  if (!isDeliverableTaskStatus(task.status)) return 'task_status_not_deliverable';
  if (task.status === 'acknowledged') {
    const assignedTo = task.assignedTo?.toLowerCase();
    const role = task.agentConfig.role.toLowerCase();
    if (assignedTo !== role) return 'acknowledged_wrong_role';
  }
  return null;
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
