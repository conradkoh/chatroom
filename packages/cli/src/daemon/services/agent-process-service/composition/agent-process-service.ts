import { createAgentProcessCommandBus } from '../infrastructure/adapters/agent-process-command-bus.js';
import type { AgentProcessManager } from '../infrastructure/agent-process-manager.js';
import { createCommandNotifier } from '../infrastructure/components/command-notifier/index.js';
import type { CommandQueueConsumerOptions } from '../infrastructure/components/command-queue/index.js';
import {
  createAgentProcessManagerService,
  type AgentProcessManagerService,
  type AgentProcessManagerCommand,
  type RestartAgentInput,
} from '../service/index.js';

export interface AgentProcessServiceCompositionDependencies {
  readonly execution: AgentProcessManager;
  readonly restartAgent?: ((input: RestartAgentInput) => Promise<void>) | undefined;
  readonly consumer?: CommandQueueConsumerOptions | undefined;
}

/** Composition root for the application service and its local infrastructure. */
export function createAgentProcessService(
  deps: AgentProcessServiceCompositionDependencies
): AgentProcessManagerService {
  const notifier = createCommandNotifier<AgentProcessManagerCommand>();
  const commandBus = createAgentProcessCommandBus({
    execution: deps.execution,
    restartAgent: deps.restartAgent,
    notifier,
    consumer: deps.consumer,
  });

  return createAgentProcessManagerService({
    execution: deps.execution,
    commandBus,
    notifier,
  });
}
