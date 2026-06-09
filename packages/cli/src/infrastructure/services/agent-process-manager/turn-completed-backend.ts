import { api } from '../../../api.js';
import type { TurnCompletedBackend } from '../../../domain/agent-lifecycle/ports/turn-completed-backend.js';

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

    emitSessionResumed: (args) =>
      deps.backend.mutation(api.machines.emitSessionResumed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>,

    emitSessionResumeFailed: (args) =>
      deps.backend.mutation(api.machines.emitSessionResumeFailed, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        ...args,
      }) as Promise<void>,
  };
}
