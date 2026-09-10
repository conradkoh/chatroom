import type { AgentCommandFactSendResult } from './agent-command-fact-outbox.js';
import { api, type Id } from '../../../api.js';
import type { AgentStoppedFact } from '../../services/agent-command-service/domain/entities/agent-fact.js';

export function createAgentCommandFactSend(input: {
  readonly sessionId: string;
  readonly machineId: string;
  readonly backend: {
    mutation: (fn: unknown, args: unknown) => Promise<unknown>;
  };
}): (fact: AgentStoppedFact) => Promise<AgentCommandFactSendResult> {
  const { sessionId, machineId, backend } = input;
  return async (fact: AgentStoppedFact) => {
    const result = (await backend.mutation(api.agentStops.reportAgentStoppedFact, {
      sessionId,
      machineId,
      fact: {
        ...fact,
        chatroomId: fact.chatroomId as Id<'chatroom_rooms'>,
      },
    })) as { success: true; applied: boolean };
    return { success: true, skipped: !result.applied };
  };
}
