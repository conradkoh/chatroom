import { InMemoryActiveTaskStateStore } from './infra/in-memory-active-task-state-store.js';
import type { AgentTaskStateService } from './interfaces/agent-task-state-service.js';
import { DefaultAgentTaskStateService } from './usecase/agent-task-state-service.js';
import type { HandoffReminder } from './usecase/handle-agent-turn-ended.js';

export type {
  ActiveTaskState,
  ActiveTaskStatus,
  AgentTaskKey,
  StartActiveTaskInput,
  TaskStateVersion,
} from './entities/active-task-state.js';
export { InMemoryActiveTaskStateStore } from './infra/in-memory-active-task-state-store.js';
export type { ActiveTaskStateStore } from './interfaces/active-task-state-store.js';
export type { AgentTaskStateService } from './interfaces/agent-task-state-service.js';
export { DefaultAgentTaskStateService } from './usecase/agent-task-state-service.js';
export {
  handleAgentTurnEnded,
  type HandleAgentTurnEndedDependencies,
  type HandleAgentTurnEndedInput,
  type HandleAgentTurnEndedResult,
  type HandoffReminder,
} from './usecase/handle-agent-turn-ended.js';

/** Constructs the daemon-owned task state service with an isolated in-memory store. */
export function createAgentTaskStateService(deps: {
  readonly reminder: HandoffReminder;
}): AgentTaskStateService {
  return new DefaultAgentTaskStateService({
    taskState: new InMemoryActiveTaskStateStore(),
    reminder: deps.reminder,
  });
}
