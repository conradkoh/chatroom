import type { AgentProcessStartReason } from '@workspace/backend/src/domain/entities/agent.js';

import type { AgentSlotState } from '../../../../domain/entities/agent-slot.js';
import type { NativeTurnPhase } from '../../../../domain/entities/native-turn-phase.js';
import type { TurnCompletionResult } from '../../../../infrastructure/local/harness/services/turn-completion.js';

export type AgentProcessSlotState = AgentSlotState;

/** Stable read model exposed to application and task services. */
export interface AgentProcessSlotView {
  readonly state: AgentProcessSlotState;
  readonly pid?: number | undefined;
  /** Configuration of the current/last process, owned by the agent process service. */
  readonly harness?: string | undefined;
  readonly model?: string | undefined;
  readonly workingDir?: string | undefined;
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
  /** The process manager normalizes missing provider results before publishing. */
  readonly completion: TurnCompletionResult;
}

export type AgentTurnDisposition =
  { readonly kind: 'release-slot' } | { readonly kind: 'hold-slot'; readonly reason: string };

export type AgentTurnEndedHandler = (
  event: AgentTurnEndedEvent
) => Promise<AgentTurnDisposition | void>;

export interface AgentStartedEvent {
  readonly chatroomId: string;
  readonly role: string;
  /** Start reason from the spawn input (e.g. user.start, platform.pending_task_wake). */
  readonly reason?: AgentProcessStartReason | undefined;
}

export type AgentStartedHandler = (event: AgentStartedEvent) => Promise<void>;

export interface AgentSessionLostEvent {
  readonly chatroomId: string;
  readonly role: string;
  /** PID of the daemon-managed process slot (keeper/server for SDK harnesses). */
  readonly pid: number;
  readonly harnessSessionId?: string | undefined;
}

export type AgentSessionLostHandler = (event: AgentSessionLostEvent) => void;

/** The agent process is producing output/progress while a slot is active. */
export interface AgentTurnProgressEvent {
  readonly chatroomId: string;
  readonly role: string;
}

export type AgentTurnProgressHandler = (event: AgentTurnProgressEvent) => void;
