import { InMemoryActiveTaskStateStore } from './infra/in-memory-active-task-state-store.js';
import type { AgentTaskStateService } from './interfaces/agent-task-state-service.js';
import { DefaultAgentTaskStateService } from './usecase/agent-task-state-service.js';

export type {
  ActiveTaskState,
  AgentTaskKey,
  StartActiveTaskInput,
} from './entities/active-task-state.js';
export { InMemoryActiveTaskStateStore } from './infra/in-memory-active-task-state-store.js';
export type { ActiveTaskStateStore } from './interfaces/active-task-state-store.js';
export type { AgentTaskStateService } from './interfaces/agent-task-state-service.js';
export { DefaultAgentTaskStateService } from './usecase/agent-task-state-service.js';
/** Constructs the daemon-owned task state service with an isolated in-memory store. */
export function createAgentTaskStateService(): AgentTaskStateService {
  return new DefaultAgentTaskStateService({
    taskState: new InMemoryActiveTaskStateStore(),
  });
}
