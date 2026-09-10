// fallow-ignore-file unused-file unused-export unused-type
// Temporary: production wiring (inbox adapter/outbox) lands in the next slice.
import type { StopReason } from '../../../../domain/entities/stop-reason.js';

export type AgentStoppedOutcome = 'stopped' | 'already_stopped';

export interface AgentStoppedFact {
  readonly kind: 'agent.stopped';
  readonly eventId: string;
  readonly intentId: string;
  readonly commandId: string;
  readonly machineId: string;
  readonly chatroomId: string;
  readonly role: string;
  readonly pid?: number;
  readonly outcome: AgentStoppedOutcome;
  readonly reason: StopReason;
  readonly occurredAt: number;
}

export function buildAgentStoppedEventId(input: {
  commandId: string;
  chatroomId: string;
  role: string;
}): string {
  return ['agent.stopped', input.commandId, input.chatroomId, input.role.trim().toLowerCase()].join(
    ':'
  );
}
