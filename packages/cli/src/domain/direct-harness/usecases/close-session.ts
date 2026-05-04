/**
 * Domain use case: close a harness session gracefully.
 *
 * Orchestrates:
 *   1. Flush any remaining buffered chunks via the sink
 *   2. Close the harness session via DirectHarnessSession.close()
 *   3. Optionally update the backend session status
 *
 * Idempotent — safe to call multiple times. Subsequent calls are no-ops.
 */

import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { MessageStreamSink } from '../ports/index.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Updates the session status in the backend after close. */
export interface SessionStatusPort {
  markClosed(harnessSessionRowId: string): Promise<void>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface CloseSessionDeps {
  readonly session: DirectHarnessSession;
  readonly sink: MessageStreamSink;
  readonly sessionStatus?: SessionStatusPort;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface CloseSessionInput {
  readonly harnessSessionRowId: string;
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function closeSession(
  deps: CloseSessionDeps,
  _input: CloseSessionInput
): Promise<void> {
  throw new Error('Not implemented');
}
