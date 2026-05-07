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
}
