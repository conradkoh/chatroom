import { isNativeHarness } from '@workspace/backend/src/domain/entities/harness/types.js';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

export { isNativeHarness };

const NATIVE_INJECTABLE_ACTIONS = [NATIVE_WAITING_ACTION] as const;

function isNativePendingAliveRunning(task: AssignedTaskView): boolean {
  const { agentConfig, status } = task;
  return (
    isNativeHarness(agentConfig.agentHarness) &&
    status === 'pending' &&
    agentConfig.spawnedAgentPid != null &&
    agentConfig.desiredState === 'running'
  );
}

function isInjectableAction(action: string | null | undefined): boolean {
  if (action == null) return true;
  return (NATIVE_INJECTABLE_ACTIONS as readonly string[]).includes(action);
}

/** True when daemon should inject a pending task into a live native session. */
export function shouldInjectNativeTask(
  task: AssignedTaskView,
  opts?: { alreadyInjectedTaskIds?: { has(taskId: string): boolean } }
): boolean {
  if (!isNativePendingAliveRunning(task)) return false;
  if (opts?.alreadyInjectedTaskIds?.has(task.taskId)) return false;
  return isInjectableAction(task.participant?.lastSeenAction);
}

function isStaleNativeWaiting(task: AssignedTaskView, now: number, thresholdMs: number): boolean {
  return (
    task.participant?.lastSeenAction === NATIVE_WAITING_ACTION && now - task.createdAt > thresholdMs
  );
}

// fallow-ignore-next-line complexity
function isStuckAfterInject(task: AssignedTaskView, now: number, thresholdMs: number): boolean {
  return (
    task.participant?.lastSeenAction === NATIVE_TASK_INJECTED_ACTION &&
    task.participant?.lastStatus === 'task.acknowledged' &&
    now - (task.participant?.lastSeenAt ?? 0) > thresholdMs
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
    isStuckAfterInject(task, now, pendingIdleThresholdMs)
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
      '⚠️ Session Management: compress_context=new_session — start fresh context within this same process.',
      'Run `chatroom get-system-prompt` if you need to reload role instructions after compaction.',
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
