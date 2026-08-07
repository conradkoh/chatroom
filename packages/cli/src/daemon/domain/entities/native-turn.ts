/**
 * Minimal slot state for turn-completion handling (domain layer).
 * Infrastructure maps AgentSlot ↔ TurnEndSlot.
 */

export type TurnEndSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

export interface TurnEndSlot {
  recentLogLines?: string[];
  harnessSessionId?: string;
  state?: TurnEndSlotState;
  pid?: number;
  /** Set when turn-end handler already emitted startFailed for a provider rate limit. */
  terminalProviderFailureHandled?: boolean;
}

export interface TurnEndInput {
  chatroomId: string;
  role: string;
  pid: number;
}

export type TurnEndOutcome = 'storm_aborted' | 'killed' | 'killed_terminal_provider_error';

export interface TurnEndResult {
  outcome: TurnEndOutcome;
}
