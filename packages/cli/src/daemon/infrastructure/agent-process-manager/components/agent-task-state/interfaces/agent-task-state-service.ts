import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
} from '../entities/active-task-state.js';

export interface AgentTaskStateService {
  get(key: AgentTaskKey): ActiveTaskState | undefined;
  start(input: StartActiveTaskInput): ActiveTaskState;
  clear(key: AgentTaskKey): boolean;
  clearAll(): number;
}
