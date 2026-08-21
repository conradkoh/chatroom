import { api } from '../../../api.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { DaemonSessionServiceShape } from '../../entry/daemon-services.js';
import type { AgentLifecycleOutboxResult } from './agent-lifecycle-outbox.js';

export function createAgentLifecycleSend(session: DaemonSessionServiceShape) {
  return async (fact: AgentLifecycleFact): Promise<AgentLifecycleOutboxResult> => {
    await session.backend.mutation(api.machines.projectAgentLifecycleFact, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      fact: fact as never,
    });
    return { success: true };
  };
}
