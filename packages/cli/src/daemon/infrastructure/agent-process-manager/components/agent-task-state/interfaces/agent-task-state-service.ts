import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
  TaskStateVersion,
} from '../entities/active-task-state.js';
import type {
  HandleAgentTurnEndedInput,
  HandleAgentTurnEndedResult,
} from '../usecase/handle-agent-turn-ended.js';

export interface AgentTaskStateService {
  get(key: AgentTaskKey): ActiveTaskState | undefined;
  start(input: StartActiveTaskInput): ActiveTaskState;
  markHandedOff(key: AgentTaskKey, version: TaskStateVersion): boolean;
  handleAgentTurnEnded(input: HandleAgentTurnEndedInput): Promise<HandleAgentTurnEndedResult>;
  clear(key: AgentTaskKey): boolean;
  clearAll(): number;
}
