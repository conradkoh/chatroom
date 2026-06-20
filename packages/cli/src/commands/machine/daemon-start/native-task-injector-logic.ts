import { getHarnessCapabilities } from '@workspace/backend/src/domain/entities/harness/types.js';
import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { parseCompressContext } from '@workspace/backend/src/domain/handoff/parse-compress-context.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';

import type { AgentHarness } from './types.js';

// fallow-ignore-next-line unused-export
export const NATIVE_INJECTABLE_ACTIONS = [
  NATIVE_WAITING_ACTION,
  'agent.waiting', // lastStatus fallback when action not yet set
] as const;

export function isNativeHarness(agentHarness: string): boolean {
  return getHarnessCapabilities(agentHarness as AgentHarness).supportsNativeIntegration;
}

/** True when daemon should inject a pending task into a live native session. */
// fallow-ignore-next-line complexity
export function shouldInjectNativeTask(
  task: AssignedTaskView,
  opts?: { alreadyInjectedTaskIds?: { has(taskId: string): boolean } }
): boolean {
  const { agentConfig, status, participant } = task;
  if (!isNativeHarness(agentConfig.agentHarness)) return false;
  if (status !== 'pending') return false;
  if (agentConfig.spawnedAgentPid == null) return false;
  if (agentConfig.desiredState !== 'running') return false;
  if (opts?.alreadyInjectedTaskIds?.has(task.taskId)) return false;

  const action = participant?.lastSeenAction;
  if (action == null) return true;
  return (NATIVE_INJECTABLE_ACTIONS as readonly string[]).includes(action);
}

function isNativePendingAliveRunning(task: AssignedTaskView): boolean {
  const { agentConfig, status } = task;
  return (
    isNativeHarness(agentConfig.agentHarness) &&
    status === 'pending' &&
    agentConfig.spawnedAgentPid != null &&
    agentConfig.desiredState === 'running'
  );
}

/** True when native agent has pending task but injection appears stuck. */
// fallow-ignore-next-line complexity
export function shouldNudgeNativeInjection(
  task: AssignedTaskView,
  now: number,
  pendingIdleThresholdMs = 15_000
): boolean {
  if (!isNativePendingAliveRunning(task)) return false;

  const action = task.participant?.lastSeenAction;
  // Stale: waiting too long with pending task
  if (action === NATIVE_WAITING_ACTION && now - task.createdAt > pendingIdleThresholdMs) {
    return true;
  }
  // Stuck after failed inject: acknowledged heartbeat never led to work
  if (
    action === NATIVE_TASK_INJECTED_ACTION &&
    task.participant?.lastStatus === 'task.acknowledged' &&
    now - (task.participant?.lastSeenAt ?? 0) > pendingIdleThresholdMs
  ) {
    return true;
  }
  return false;
}

/** Shape injected prompt: task delivery body + optional compaction header. */
export function buildNativeInjectionPrompt(params: {
  taskDeliveryOutput: string;
  taskContent: string;
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
