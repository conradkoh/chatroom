// fallow-ignore-file unused-file unused-type
import type { OutboundEvent } from '../../domain/entities/outbound-event.js';
import type { AgentReadModelRow } from '../../infrastructure/persistence/read-models/agents.js';
import type { ParticipantReadModelRow } from '../../infrastructure/persistence/read-models/participants.js';

export interface AgentLifecyclePort {
  appendLifecycleEvent(event: OutboundEvent): void;
  updateAgentReadModel(row: AgentReadModelRow): void;
  updateParticipantReadModel(row: ParticipantReadModelRow): void;
}
