import type { NativeTurnPhase } from '../../../../domain/entities/native-turn-phase.js';

export type AgentProcessSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

/** Stable read model exposed to application and task services. */
export interface AgentProcessSlotView {
  readonly state: AgentProcessSlotState;
  readonly pid?: number | undefined;
  readonly harnessSessionId?: string | undefined;
  readonly nativeTurnPhase?: NativeTurnPhase | undefined;
}

export interface AgentTurnEndedEvent {
  readonly chatroomId: string;
  readonly role: string;
  readonly pid: number;
  readonly harness: string;
  readonly slot: AgentProcessSlotView;
  readonly eventId: string;
}

export type AgentTurnEndedHandler = (event: AgentTurnEndedEvent) => Promise<void>;

export interface AgentStartedEvent {
  readonly chatroomId: string;
  readonly role: string;
}

export type AgentStartedHandler = (event: AgentStartedEvent) => Promise<void>;

export interface AgentSessionLostEvent {
  readonly chatroomId: string;
  readonly role: string;
  readonly harnessSessionId?: string | undefined;
}

export type AgentSessionLostHandler = (event: AgentSessionLostEvent) => void;
