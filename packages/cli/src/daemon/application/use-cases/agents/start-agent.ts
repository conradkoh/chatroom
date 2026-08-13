import type { AgentReadModelRow } from '../../../infrastructure/persistence/read-models/agents.js';
import type { ParticipantReadModelRow } from '../../../infrastructure/persistence/read-models/participants.js';
import type { AgentLifecyclePort } from '../../ports/agent-lifecycle.port.js';

export interface StartAgentInput {
  chatroomId: string;
  role: string;
  pid: number;
  harnessSessionId?: string;
  timestamp?: number;
}

export interface StartAgentDeps {
  machineId: string;
  lifecycle: Pick<AgentLifecyclePort, 'updateAgentReadModel' | 'updateParticipantReadModel'>;
  now?: () => number;
}

/**
 * Local agent-start read model update. Records the spawned agent (pid, harness
 * session) synchronously so downstream reads see it without a Convex round-trip.
 */
export function startAgent(deps: StartAgentDeps, input: StartAgentInput): void {
  const timestamp = deps.now?.() ?? Date.now();
  const agentRow: AgentReadModelRow = {
    machineId: deps.machineId,
    role: input.role,
    pid: input.pid,
    harnessSessionId: input.harnessSessionId,
    updatedAt: timestamp,
  };
  deps.lifecycle.updateAgentReadModel(agentRow);

  const participantRow: ParticipantReadModelRow = {
    chatroomId: input.chatroomId,
    role: input.role,
    turnPhase: 'agent.waiting',
    lastSeenAt: timestamp,
    updatedAt: timestamp,
  };
  deps.lifecycle.updateParticipantReadModel(participantRow);
}
