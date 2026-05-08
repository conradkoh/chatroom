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

  /** Mark a session as closed in the backend (user-initiated). */
  markClosed(harnessSessionId: string): Promise<void>;

  /**
   * Mark a session as idle (disconnected but resumable).
   * Used when a prompt fails or the harness crashes — opencode still has
   * the session on disk.
   */
  markIdle(harnessSessionId: string): Promise<void>;

  /**
   * Mark a session as permanently failed.
   * Used when the workspace is gone or opencode confirms the session does
   * not exist on disk.
   */
  markFailed(harnessSessionId: string): Promise<void>;

  /**
   * Mark a session as active after a successful lazy-resume.
   */
  markActive(harnessSessionId: string): Promise<void>;

  /** Advance the daemon's turn-seq cursor for a session. */
  markTurnProcessed(harnessSessionId: string, turnSeq: number): Promise<void>;

  /** Set the isGenerating flag so the web send mutation routes to the queue. */
  setGenerating(harnessSessionId: string, isGenerating: boolean): Promise<void>;

  /**
   * Atomically promote the oldest queued message into the main message table.
   * Returns the promoted message or null when the queue is empty
   * (also clears isGenerating on the session).
   */
  dequeueNext(harnessSessionId: string): Promise<{ content: string; seq: number } | null>;

  // ─── Turn lifecycle ──────────────────────────────────────────────────────────

  /**
   * Eagerly insert an assistant turn row with status='pending'.
   * Returns the new turn ID and its sequence number.
   */
  beginAssistantTurn(harnessSessionId: string): Promise<{ turnId: string; turnSeq: number }>;

  /**
   * Bind the SDK messageId to a pending turn, flipping it to status='streaming'.
   * Idempotent: no-op if the turn is already streaming/complete.
   */
  bindTurnMessageId(turnId: string, messageId: string): Promise<void>;

  /**
   * Finalize an assistant turn by aggregating chunk content.
   * Sets status='complete' with concatenated textContent/reasoningContent.
   * Idempotent: no-op if the turn is already complete.
   */
  finalizeAssistantTurn(turnId: string): Promise<void>;
}
