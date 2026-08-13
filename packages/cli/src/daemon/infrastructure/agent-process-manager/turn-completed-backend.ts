import { api } from '../../../api.js';
import type { AgentLifecyclePort } from '../../application/ports/agent-lifecycle.port.js';
import { buildAgentStartFailedEvent } from '../../domain/events/agent-lifecycle.js';
import type { TurnCompletedBackend } from '../../domain/usecase/handle-turn-completed.js';

export function createTurnCompletedBackend(deps: {
  sessionId: string;
  machineId: string;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
  /** P4: local lifecycle port — routes emitAgentStartFailed via events when provided. */
  lifecycle?: AgentLifecyclePort;
  isP4?: boolean;
}): TurnCompletedBackend {
  return {
    emitResumeStormAborted: (args) =>
      deps.backend.mutation(api.agentResumeStorm.emitResumeStormAborted, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>,

    emitAgentStartFailed: (args) => {
      if (deps.isP4 && deps.lifecycle) {
        deps.lifecycle.appendLifecycleEvent(
          buildAgentStartFailedEvent({
            chatroomId: args.chatroomId,
            role: args.role,
            machineId: deps.machineId,
            error: args.error,
            timestamp: Date.now(),
          })
        );
        deps.lifecycle.updateAgentReadModel({
          machineId: deps.machineId,
          role: args.role,
          pid: undefined,
          updatedAt: Date.now(),
        });
        return Promise.resolve();
      }
      return deps.backend.mutation(api.machines.emitAgentStartFailed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>;
    },
  };
}
