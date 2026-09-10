// fallow-ignore-file unused-file unused-type
// Temporary: production wiring (inbox adapter/outbox) lands in the next slice.
import type { AgentStoppedFact } from './agent-fact.js';
import type { StopReason } from '../../../../domain/entities/stop-reason.js';

export type AgentStopCommandTarget =
  | {
      readonly kind: 'agent';
      readonly chatroomId: string;
      readonly role: string;
    }
  | {
      readonly kind: 'chatroom';
      readonly chatroomId: string;
    };

export interface AgentStopCommand {
  readonly commandId: string;
  readonly intentId: string;
  readonly machineId: string;
  readonly target: AgentStopCommandTarget;
  readonly reason: StopReason;
  readonly createdAt: number;
  readonly deadlineAt: number;
}

export interface AgentStopFailure {
  readonly chatroomId: string;
  readonly role: string;
  readonly error: string;
}

export type AgentStopCommandStatus = 'completed' | 'partial_failure' | 'expired';

export interface AgentStopCommandResult {
  readonly commandId: string;
  readonly status: AgentStopCommandStatus;
  readonly facts: readonly AgentStoppedFact[];
  readonly failures: readonly AgentStopFailure[];
}
