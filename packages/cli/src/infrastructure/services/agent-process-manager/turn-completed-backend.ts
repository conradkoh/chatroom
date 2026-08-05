import { api } from '../../../api.js';
import type { TurnCompletedBackend } from '../../../v2/domain/usecase/handle-turn-completed.js';

export function createTurnCompletedBackend(deps: {
  sessionId: string;
  machineId: string;
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

    emitAgentStartFailed: (args) =>
      deps.backend.mutation(api.machines.emitAgentStartFailed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>,
  };
}
