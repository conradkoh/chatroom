/**
 * Minimal slot state for turn-completion handling (domain layer).
 * Infrastructure maps AgentSlot ↔ TurnEndSlot.
 */

import type { AgentSlotState } from './agent-slot.js';

export type TurnEndSlotState = AgentSlotState;

export interface TurnEndSlot {
  recentLogLines?: string[] | undefined;
  harnessSessionId?: string | undefined;
  state?: TurnEndSlotState | undefined;
  pid?: number | undefined;
  /** Set when turn-end handler already emitted startFailed for a provider rate limit. */
  terminalProviderFailureHandled?: boolean | undefined;
}
