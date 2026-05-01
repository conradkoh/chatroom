/**
 * Interface for an active session with a running harness process.
 */

import type { HarnessSessionId } from './harness-worker.js';

/** A single event emitted by a harness process during a session. */
export interface DirectHarnessSessionEvent {
  /** Harness-specific event type discriminant (e.g. 'message', 'tool_call'). */
  readonly type: string;
  /** Harness-specific payload; callers must narrow based on `type`. */
  readonly payload: unknown;
  readonly timestamp: number;
}

/** Represents an open, bidirectional session with a harness process. */
export interface DirectHarnessSession {
  /** The session identifier assigned by the harness on spawn. */
  readonly harnessSessionId: HarnessSessionId;
  /** Send a user or system message to the running harness. */
  send(input: string): Promise<void>;
  /**
   * Subscribe to events emitted by the harness.
   * Returns an unsubscribe function.
   */
  onEvent(listener: (event: DirectHarnessSessionEvent) => void): () => void;
  /** Cleanly shut down the session and release resources. */
  close(): Promise<void>;
}
