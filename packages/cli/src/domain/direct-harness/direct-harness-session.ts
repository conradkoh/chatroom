/**
 * Interface for an active session with a running harness process.
 */

import type { HarnessSessionId } from './harness-session.js';

/** A single event emitted by a harness process during a session. */
export interface DirectHarnessSessionEvent {
  /** Harness-specific event type discriminant (e.g. 'message', 'tool_call'). */
  readonly type: string;
  /** Harness-specific payload; callers must narrow based on `type`. */
  readonly payload: unknown;
  readonly timestamp: number;
}

/** A single content part within a prompt. */
export interface PromptPart {
  readonly type: 'text';
  readonly text: string;
}

/** Input to a prompt call — agent and structured content parts. */
export interface PromptInput {
  /** The agent sending the prompt (e.g. 'builder', 'planner'). */
  readonly agent: string;
  readonly parts: readonly PromptPart[];
}

/** Represents an open, bidirectional session with a harness process. */
export interface DirectHarnessSession {
  /** The session identifier assigned by the harness on spawn. */
  readonly harnessSessionId: HarnessSessionId;
  /**
   * Send a structured prompt to the running harness.
   * The agent is passed per-call so a single session can serve multiple roles.
   */
  prompt(input: PromptInput): Promise<void>;
  /**
   * Subscribe to events emitted by the harness.
   * Returns an unsubscribe function.
   */
  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void;
  /** Cleanly shut down the session and release resources. */
  close(): Promise<void>;
}
