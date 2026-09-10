// Temporary: production wiring (inbox adapter/outbox) lands in the next slice.
import type { AgentStoppedFact } from '../../domain/entities/agent-fact.js';

export interface AgentFactSink {
  append(fact: AgentStoppedFact): Promise<void>;
}
