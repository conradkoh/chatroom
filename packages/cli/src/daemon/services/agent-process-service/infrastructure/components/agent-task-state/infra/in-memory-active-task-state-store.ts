import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
} from '../entities/active-task-state.js';
import type { ActiveTaskStateStore } from '../interfaces/active-task-state-store.js';

function keyOf(key: AgentTaskKey): string {
  return `${key.chatroomId}:${key.role.toLowerCase()}`;
}

export class InMemoryActiveTaskStateStore implements ActiveTaskStateStore {
  private readonly states = new Map<string, ActiveTaskState>();

  get(key: AgentTaskKey): ActiveTaskState | undefined {
    const state = this.states.get(keyOf(key));
    return state ? { ...state } : undefined;
  }

  start(input: StartActiveTaskInput): ActiveTaskState {
    const state: ActiveTaskState = {
      chatroomId: input.chatroomId,
      role: input.role,
      taskId: input.taskId,
    };
    this.states.set(keyOf(input), state);
    return { ...state };
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
