import type { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import {
  isInjectableNativeAction,
  isNativeAcknowledgedInjectionRetry,
  isNativeIdleAfterTaskComplete,
  isNativeInjectableAliveRunning,
} from '../../../domain/native-integration/predicates.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should inject a pending task into a live native session. */
// fallow-ignore-next-line complexity
export function shouldInjectNativeTask(
  task: AssignedTaskView,
  opts?: { alreadyInjectedTaskIds?: { has(taskId: string): boolean } }
): boolean {
  if (!isNativeInjectableAliveRunning(task)) return false;
  if (opts?.alreadyInjectedTaskIds?.has(task.taskId)) return false;
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

export class NativeInjectionDedup {
  private readonly injected = new Set<string>();
  private readonly inFlight = new Set<string>();

  /** Reserve a task for injection; returns false if already injected or in flight. */
  tryAcquire(taskId: string): boolean {
    if (this.has(taskId) || this.inFlight.has(taskId)) {
      return false;
    }
    this.inFlight.add(taskId);
    return true;
  }

  markInjected(taskId: string): void {
    this.inFlight.delete(taskId);
    this.injected.add(taskId);
  }

  // Used by shouldInjectNativeTask via alreadyInjectedTaskIds duck typing.
  has(taskId: string): boolean {
    return this.injected.has(taskId);
  }

  /** Release in-flight or completed injection so a retry can proceed. */
  clear(taskId: string): void {
    this.inFlight.delete(taskId);
    this.injected.delete(taskId);
  }
}
