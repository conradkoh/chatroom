import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
} from '../entities/active-task-state.js';
import type { ActiveTaskStateStore } from '../interfaces/active-task-state-store.js';
import type { AgentTaskStateService } from '../interfaces/agent-task-state-service.js';

export class DefaultAgentTaskStateService implements AgentTaskStateService {
  constructor(private readonly deps: { readonly taskState: ActiveTaskStateStore }) {}

  get(key: AgentTaskKey): ActiveTaskState | undefined {
    return this.deps.taskState.get(key);
  }

  start(input: StartActiveTaskInput): ActiveTaskState {
    return this.deps.taskState.start(input);
  }

  clear(key: AgentTaskKey): boolean {
    return this.deps.taskState.clear(key);
  }

  clearAll(): number {
    return this.deps.taskState.clearAll();
  }
}
