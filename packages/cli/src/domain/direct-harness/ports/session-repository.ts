import type { OpenCodeSessionId } from '../entities/harness-session.js';

export interface SessionRepository {
  /** Associate the OpenCode-issued session ID with an existing backend row. */
  associateOpenCodeSessionId(
    harnessSessionId: string,
    opencodeSessionId: string,
    sessionTitle: string
  ): Promise<void>;

  /** Read the OpenCode session ID for a given backend row. */
  getOpenCodeSessionId(harnessSessionId: string): Promise<OpenCodeSessionId | undefined>;

  /** Mark a session as closed in the backend. */
  markClosed(harnessSessionId: string): Promise<void>;

  /** Persist the daemon's processing cursor for a session. */
  updateLastProcessedSeq(harnessSessionId: string, seq: number): Promise<void>;

  /** Set the isGenerating flag so the web send mutation routes to the queue. */
  setGenerating(harnessSessionId: string, isGenerating: boolean): Promise<void>;

  /**
   * Atomically promote the oldest queued message into the main message table.
   * Returns the promoted message or null when the queue is empty
   * (also clears isGenerating on the session).
   */
  dequeueNext(harnessSessionId: string): Promise<{ content: string; seq: number } | null>;
}
