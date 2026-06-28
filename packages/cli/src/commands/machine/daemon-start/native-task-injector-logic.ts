import type { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskLiteView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';

import type { NativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  isInjectableNativeAction,
  isNativeAcknowledgedInjectionRetry,
  isNativeIdleAfterTaskComplete,
  isNativeInjectableAliveRunning,
} from '../../../domain/native-integration/predicates.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should deliver a task into a live native harness session. */
// fallow-ignore-next-line complexity
export function shouldDeliverNativeTask(
  task: AssignedTaskLiteView,
  opts: { ledger: NativeDeliveryLedger; harnessSessionId: string | undefined }
): boolean {
  if (!isNativeInjectableAliveRunning(task)) return false;
  if (!opts.harnessSessionId) return false;
  if (opts.ledger.isDelivered(task.taskId, opts.harnessSessionId)) return false;
  return (
    isInjectableNativeAction(task.participant?.lastSeenAction) ||
    isNativeIdleAfterTaskComplete(task.participant ?? {}) ||
    isNativeAcknowledgedInjectionRetry(task)
  );
}

/** Shape injected prompt: task delivery body + optional compaction header. */
export function buildNativeInjectionPrompt(params: {
  taskDeliveryOutput: string;
  compressMode: ReturnType<typeof parseCompressContext>;
}): string {
  const { taskDeliveryOutput, compressMode } = params;
  if (compressMode === 'new_session') {
    return [
      '⚠️ Context was compacted. Run `chatroom get-system-prompt` only if role instructions are missing.',
      '',
      taskDeliveryOutput,
    ].join('\n');
  }
  return taskDeliveryOutput;
}
