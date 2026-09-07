import {
  handleAgentTurnEnded,
  type HandleAgentTurnEndedDependencies,
  type HandleAgentTurnEndedInput,
  type HandleAgentTurnEndedResult,
} from './handle-agent-turn-ended.js';
import type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
  TaskStateVersion,
} from '../entities/active-task-state.js';
import type { AgentTaskStateService } from '../interfaces/agent-task-state-service.js';

export class DefaultAgentTaskStateService implements AgentTaskStateService {
  constructor(private readonly deps: HandleAgentTurnEndedDependencies) {}

  get(key: AgentTaskKey): ActiveTaskState | undefined {
    return this.deps.taskState.get(key);
  }

  start(input: StartActiveTaskInput): ActiveTaskState {
    return this.deps.taskState.start(input);
  }

  markHandedOff(key: AgentTaskKey, version: TaskStateVersion): boolean {
    return this.deps.taskState.markHandedOff(key, version);
  }

  handleAgentTurnEnded(input: HandleAgentTurnEndedInput): Promise<HandleAgentTurnEndedResult> {
    return handleAgentTurnEnded(this.deps, input);
  }

  clear(key: AgentTaskKey): boolean {
    return this.deps.taskState.clear(key);
  }

  clearAll(): number {
    return this.deps.taskState.clearAll();
  }
}
