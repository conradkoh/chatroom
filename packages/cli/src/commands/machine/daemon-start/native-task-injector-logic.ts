import type { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import {
  isInjectableNativeAction,
  isNativeIdleAfterTaskComplete,
  isNativePendingAliveRunning,
  isStaleNativeWaiting,
  isStuckAfterNativeInject,
} from '../../../domain/native-integration/predicates.js';

export { isNativeHarness } from '../../../domain/native-integration/index.js';

/** True when daemon should inject a pending task into a live native session. */
export function shouldInjectNativeTask(
  task: AssignedTaskView,
  opts?: { alreadyInjectedTaskIds?: { has(taskId: string): boolean } }
): boolean {
  if (!isNativePendingAliveRunning(task)) return false;
  if (opts?.alreadyInjectedTaskIds?.has(task.taskId)) return false;
  return (
    isInjectableNativeAction(task.participant?.lastSeenAction) ||
    isNativeIdleAfterTaskComplete(task.participant ?? {})
  );
}

/** True when native agent has pending task but injection appears stuck. */
export function shouldNudgeNativeInjection(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs = 15_000
): boolean {
  if (!isNativePendingAliveRunning(task)) return false;
  return (
    isStaleNativeWaiting(task, now, pendingIdleThresholdMs) ||
    isStuckAfterNativeInject(task, now, pendingIdleThresholdMs)
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
  markInjected(taskId: string): void {
    if (!this.has(taskId)) {
      this.injected.add(taskId);
    }
  }
  has(taskId: string): boolean {
    return this.injected.has(taskId);
  }
  clear(taskId: string): void {
    this.injected.delete(taskId);
  }
}
