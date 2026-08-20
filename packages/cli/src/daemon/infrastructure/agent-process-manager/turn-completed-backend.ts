import { api } from '../../../api.js';
import type { TurnCompletedBackend } from '../../domain/usecase/handle-turn-completed.js';
import { logDaemonAuditEvent } from '../event-stream/daemon-event-emitter.js';

export function createTurnCompletedBackend(deps: {
  sessionId: string;
  machineId: string;
  logEvent: (event: Record<string, unknown>) => Promise<void>;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}): TurnCompletedBackend {
  return {
    emitResumeStormAborted: (args) =>
      deps.backend.mutation(api.agentResumeStorm.emitResumeStormAborted, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>,

    emitAgentStartFailed: async (args) => {
      await logDaemonAuditEvent(deps.logEvent, {
        type: 'agent.startFailed',
        machineId: deps.machineId,
        ...args,
      });
      await deps.backend.mutation(api.daemon.agentEvents.agentStartFailed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      });
    },
  };
}
