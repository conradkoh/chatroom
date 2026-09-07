import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
  TaskStateVersion,
} from '../entities/active-task-state.js';
import type { ActiveTaskStateStore } from '../interfaces/active-task-state-store.js';

function keyOf(key: AgentTaskKey): string {
  return `${key.chatroomId}:${key.role.toLowerCase()}`;
}

function matches(state: ActiveTaskState, version: TaskStateVersion): boolean {
  return state.taskId === version.taskId && state.generation === version.generation;
}

export class InMemoryActiveTaskStateStore implements ActiveTaskStateStore {
  private readonly states = new Map<string, ActiveTaskState>();

  get(key: AgentTaskKey): ActiveTaskState | undefined {
    const state = this.states.get(keyOf(key));
    return state ? { ...state } : undefined;
  }

  start(input: StartActiveTaskInput): ActiveTaskState {
    const previous = this.states.get(keyOf(input));
    const state: ActiveTaskState = {
      chatroomId: input.chatroomId,
      role: input.role,
      taskId: input.taskId,
      generation: (previous?.generation ?? 0) + 1,
      status: 'in_flight',
      handedOff: false,
      reminderAttempts: 0,
    };
    this.states.set(keyOf(input), state);
    return { ...state };
  }

  markHandedOff(key: AgentTaskKey, version: TaskStateVersion): boolean {
    const state = this.states.get(keyOf(key));
    if (!state || !matches(state, version)) return false;

    this.states.set(keyOf(key), {
      ...state,
      status: 'handed_off',
      handedOff: true,
    });
    return true;
  }

  recordTurnEnd(
    key: AgentTaskKey,
    version: TaskStateVersion,
    eventId: string
  ): ActiveTaskState | undefined {
    const state = this.states.get(keyOf(key));
    if (!state || !matches(state, version) || state.lastTurnEndEventId === eventId) {
      return undefined;
    }

    const next: ActiveTaskState = {
      ...state,
      status: state.handedOff ? 'handed_off' : 'reminder_requested',
      reminderAttempts: state.handedOff ? state.reminderAttempts : state.reminderAttempts + 1,
      lastTurnEndEventId: eventId,
    };
    this.states.set(keyOf(key), next);
    return { ...next };
  }

  complete(key: AgentTaskKey, version: TaskStateVersion): boolean {
    const state = this.states.get(keyOf(key));
    if (!state || !matches(state, version)) return false;
    this.states.delete(keyOf(key));
    return true;
  }

  clear(key: AgentTaskKey): boolean {
    return this.states.delete(keyOf(key));
  }

  clearAll(): number {
    const count = this.states.size;
    this.states.clear();
    return count;
  }
}
