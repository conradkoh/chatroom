// fallow-ignore-file unused-file unused-type
// Temporary: production wiring (inbox adapter/outbox) lands in the next slice.
import type { StopReason } from '../../../../domain/entities/stop-reason.js';

export interface AgentCommandActiveAgent {
  readonly chatroomId: string;
  readonly role: string;
  readonly pid?: number;
}

export interface AgentCommandProcessManager {
  listActive(): readonly AgentCommandActiveAgent[];
  stopAgent(input: {
    readonly chatroomId: string;
    readonly role: string;
    readonly reason: StopReason;
    readonly pid?: number;
  }): Promise<{ readonly success: boolean; readonly error?: string }>;
}
