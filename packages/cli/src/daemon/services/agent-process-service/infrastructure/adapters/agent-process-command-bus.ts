import type {
  AgentProcessManagerCommand,
  AgentProcessManagerExecutionPort,
  RestartAgentInput,
} from '../../service/agent-process-manager-service.js';
import {
  assertStartSucceeded,
  assertStopSucceeded,
} from '../../service/operation-result-assertions.js';
import type { AgentProcessCommandBus } from '../../service/ports/agent-process-command-bus.js';
import type { AgentProcessNotifier } from '../../service/ports/agent-process-notifier.js';
import {
  CommandQueueConsumer,
  createCommandQueue,
  type CommandQueueConsumerOptions,
  type ReceivedCommandMessage,
} from '../components/command-queue/index.js';

export interface AgentProcessCommandBusDependencies {
  readonly execution: AgentProcessManagerExecutionPort;
  readonly restartAgent?: ((input: RestartAgentInput) => Promise<void>) | undefined;
  readonly notifier: AgentProcessNotifier<AgentProcessManagerCommand>;
  readonly consumer?: CommandQueueConsumerOptions | undefined;
}

/** Infrastructure adapter that backs the application command bus with FIFO polling. */
export function createAgentProcessCommandBus(
  deps: AgentProcessCommandBusDependencies
): AgentProcessCommandBus {
  const queue = createCommandQueue<AgentProcessManagerCommand>();
  const consumer = new CommandQueueConsumer({
    queue,
    notifier: deps.notifier,
    ...deps.consumer,
    // fallow-ignore-next-line complexity
    dispatch: async (message: ReceivedCommandMessage<AgentProcessManagerCommand>) => {
      const { type, input } = message.body;
      switch (type) {
        case 'start':
          assertStartSucceeded(await deps.execution.ensureRunning(input));
          return;
        case 'stop':
          assertStopSucceeded(await deps.execution.stop(input));
          return;
        case 'restart':
          if (!deps.restartAgent)
            throw new Error('Agent process manager restart execution is not wired yet');
          await deps.restartAgent(input);
          return;
      }
    },
  });

  return {
    send: async (input) => {
      await queue.sendMessage(input);
    },
    purge: async (input) => queue.purge(input),
    start: () => consumer.start(),
    stop: () => consumer.stop(),
    debugSnapshot: () => queue.debugSnapshot?.() ?? [],
  };
}
