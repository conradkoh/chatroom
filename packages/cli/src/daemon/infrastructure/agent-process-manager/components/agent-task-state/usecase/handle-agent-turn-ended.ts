import type { AgentTaskKey, TaskStateVersion } from '../entities/active-task-state.js';
import type { ActiveTaskStateStore } from '../interfaces/active-task-state-store.js';

export interface HandoffReminder {
  remind(input: {
    chatroomId: string;
    role: string;
    taskId: string;
    attempt: number;
  }): Promise<void>;
}

export interface HandleAgentTurnEndedInput extends AgentTaskKey {
  readonly version: TaskStateVersion;
  readonly eventId: string;
}

export type HandleAgentTurnEndedResult =
  | { readonly outcome: 'no_active_task' }
  | { readonly outcome: 'stale_event' }
  | { readonly outcome: 'duplicate_event' }
  | { readonly outcome: 'already_handed_off'; readonly taskId: string }
  | { readonly outcome: 'reminder_requested'; readonly taskId: string; readonly attempt: number };

export interface HandleAgentTurnEndedDependencies {
  readonly taskState: ActiveTaskStateStore;
  readonly reminder: HandoffReminder;
}

export async function handleAgentTurnEnded(
  deps: HandleAgentTurnEndedDependencies,
  input: HandleAgentTurnEndedInput
): Promise<HandleAgentTurnEndedResult> {
  const active = deps.taskState.get(input);
  if (!active) return { outcome: 'no_active_task' };
  if (active.taskId !== input.version.taskId || active.generation !== input.version.generation) {
    return { outcome: 'stale_event' };
  }
  if (active.lastTurnEndEventId === input.eventId) {
    return { outcome: 'duplicate_event' };
  }

  const recorded = deps.taskState.recordTurnEnd(input, input.version, input.eventId);
  if (!recorded) return { outcome: 'stale_event' };

  if (recorded.handedOff) {
    deps.taskState.complete(input, input.version);
    return { outcome: 'already_handed_off', taskId: recorded.taskId };
  }

  await deps.reminder.remind({
    chatroomId: recorded.chatroomId,
    role: recorded.role,
    taskId: recorded.taskId,
    attempt: recorded.reminderAttempts,
  });
  return {
    outcome: 'reminder_requested',
    taskId: recorded.taskId,
    attempt: recorded.reminderAttempts,
  };
}
