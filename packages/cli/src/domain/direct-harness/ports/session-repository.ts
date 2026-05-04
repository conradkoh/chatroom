/**
 * Repository port for harness session persistence.
 *
 * Covers session lifecycle (create, associate, close) and queries
 * needed by the domain use cases.
 */

import type { HarnessSessionId } from '../entities/harness-session.js';

export interface SessionRepository {
  /** Create a new backend session row and return its identifier. */
  createSession(
    workspaceId: string,
    harnessName: string,
    config: { agent: string }
  ): Promise<{ harnessSessionRowId: string }>;

  /** Associate a harness-issued session ID with an existing backend row. */
  associateHarnessSessionId(
    harnessSessionRowId: string,
    harnessSessionId: string,
    sessionTitle: string
  ): Promise<void>;

  /** Read the harness-issued session ID for a given backend row. */
  getHarnessSessionId(harnessSessionRowId: string): Promise<HarnessSessionId | undefined>;

  /** Mark a session as closed in the backend. */
  markClosed(harnessSessionRowId: string): Promise<void>;
}
