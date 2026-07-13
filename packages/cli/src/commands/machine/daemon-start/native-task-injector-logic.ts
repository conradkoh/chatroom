import type { parseSessionAugmentation } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import {
  isAgentReadyForNativeDelivery,
  isDeliverableNativeTaskStatus,
} from './native-ready-invariant.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should deliver a task into a live native harness session. */
export function shouldDeliverNativeTask(
  task: AssignedTaskSnapshotView,
  opts: { slot: AgentSlot | undefined }
): boolean {
  if (!isDeliverableNativeTaskStatus(task.status)) return false;
  if (task.status === 'acknowledged') {
    const assignedTo = task.assignedTo?.toLowerCase();
    if (assignedTo !== task.agentConfig.role.toLowerCase()) return false;
  }
  return isAgentReadyForNativeDelivery(task, opts.slot);
}

/** Shape injected prompt: task delivery body + optional augmentation preamble. */
export function buildNativeInjectionPrompt(params: {
  taskDeliveryOutput: string;
  augmentationMode: ReturnType<typeof parseSessionAugmentation>;
}): string {
  const { taskDeliveryOutput, augmentationMode } = params;
  if (augmentationMode === 'compact') {
    return [
      '⚠️ Context was compacted. Run `chatroom get-system-prompt` only if role instructions are missing.',
      '',
      taskDeliveryOutput,
    ].join('\n');
  }
  if (augmentationMode === 'new_session') {
    return [
      '⚠️ Starting a new agent session. Run `chatroom get-system-prompt` to reload role instructions if needed.',
      '',
      taskDeliveryOutput,
    ].join('\n');
  }
  return taskDeliveryOutput;
}
