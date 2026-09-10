// Temporary: Convex inbox adapter and daemon startup composition land in later slices.
import type { AgentProcessManagerService } from '../../index.js';
import {
  createAgentStopCommandExecutor,
  type AgentStopCommandExecutor,
} from '../service/agent-command-service.js';
import type { AgentFactSink } from '../service/ports/agent-fact-sink.js';

export interface AgentCommandServiceCompositionDependencies {
  readonly processManager: AgentProcessManagerService;
  readonly factSink: AgentFactSink;
  readonly now?: (() => number) | undefined;
}

export function createAgentStopCommandService(
  deps: AgentCommandServiceCompositionDependencies
): AgentStopCommandExecutor {
  // Structural adapter: the existing process manager remains the process and
  // slot authority. This only maps its views/results to the command port.
  return createAgentStopCommandExecutor({
    processManager: {
      listActive: () =>
        deps.processManager.listActive().map(({ chatroomId, role, slot }) => ({
          chatroomId,
          role,
          ...(slot.pid === undefined ? {} : { pid: slot.pid }),
        })),
      stopAgent: async (input) => {
        const result = await deps.processManager.stopAgent(input);
        if (result.status === 'succeeded') return { success: true };
        return {
          success: false,
          error:
            result.error instanceof Error
              ? result.error.message
              : result.error === undefined
                ? ['agent stop', result.status].join(' ')
                : String(result.error),
        };
      },
    },
    factSink: deps.factSink,
    now: deps.now,
  });
}
