import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
  TaskStateVersion,
} from '../entities/active-task-state.js';

export interface ActiveTaskStateStore {
  get(key: AgentTaskKey): ActiveTaskState | undefined;
  start(input: StartActiveTaskInput): ActiveTaskState;
  markHandedOff(key: AgentTaskKey, version: TaskStateVersion): boolean;
  recordTurnEnd(
    key: AgentTaskKey,
    version: TaskStateVersion,
    eventId: string
  ): ActiveTaskState | undefined;
  complete(key: AgentTaskKey, version: TaskStateVersion): boolean;
  clear(key: AgentTaskKey): boolean;
  clearAll(): number;
}
