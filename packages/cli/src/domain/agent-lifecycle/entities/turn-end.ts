/**
 * Minimal slot state for turn-completion handling (domain layer).
 * Infrastructure maps AgentSlot ↔ TurnEndSlot.
 */

export type TurnEndSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

export interface TurnEndSlot {
  resumeInFlight?: boolean;
  recentLogLines?: string[];
  harnessSessionId?: string;
  state?: TurnEndSlotState;
  pid?: number;
  /** Set when in-turn resumeTurn failed; handleExit must cold-restart without daemon-memory resume. */
  turnResumeFailed?: boolean;
}

export interface TurnEndInput {
  chatroomId: string;
  role: string;
  pid: number;
  supportsSessionResume: boolean;
  /** User's persisted "resume session" preference, captured at spawn. */
  wantResume: boolean;
}

export type TurnEndOutcome = 'storm_aborted' | 'skipped_duplicate' | 'resumed' | 'killed';

export interface TurnEndResult {
  outcome: TurnEndOutcome;
}
