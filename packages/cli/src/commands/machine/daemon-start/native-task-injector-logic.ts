import type { parseSessionAugmentation } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { NativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  isInjectableNativeAction,
  isNativeAcknowledgedInjectionRetry,
  isNativeIdleAfterTaskComplete,
  isNativeInjectableAliveRunning,
  isNativePendingRedeliveryAfterRelease,
} from '../../../domain/native-integration/predicates.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should deliver a task into a live native harness session. */
// fallow-ignore-next-line complexity
export function shouldDeliverNativeTask(
  task: AssignedTaskSnapshotView,
  opts: { ledger: NativeDeliveryLedger; harnessSessionId: string | undefined }
): boolean {
  if (!isNativeInjectableAliveRunning(task)) return false;
  if (!opts.harnessSessionId) return false;
  if (opts.ledger.isDelivered(task.taskId, opts.harnessSessionId) && task.status !== 'pending') {
    return false;
  }
  return (
    isInjectableNativeAction(task.participant?.lastSeenAction) ||
    isNativeIdleAfterTaskComplete(task.participant ?? {}) ||
    isNativeAcknowledgedInjectionRetry(task) ||
    isNativePendingRedeliveryAfterRelease(task)
  );
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
