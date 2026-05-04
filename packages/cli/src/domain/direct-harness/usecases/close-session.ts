/**
 * Domain use case: close a harness session gracefully.
 *
 * Orchestrates:
 *   1. Commit the journal to persist any remaining buffered chunks
 *   2. Close the harness session via DirectHarnessSession.close()
 *   3. Optionally mark the session as closed in the backend
 *
 * Idempotent — safe to call multiple times when wrapped by the caller.
 *
 * This is the building block used internally by SessionHandle.close().
 * Callers that hold a SessionHandle should call handle.close() directly;
 * this use case is for scenarios where you have the raw session + journal
 * but weren't created through openSession (e.g. manual or testing paths).
 */

import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionJournal } from './open-session.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Updates the session status in the backend after close. */
export interface SessionStatusPort {
  markClosed(harnessSessionRowId: string): Promise<void>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface CloseSessionDeps {
  readonly session: DirectHarnessSession;
  readonly journal: SessionJournal;
  readonly sessionStatus?: SessionStatusPort;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface CloseSessionInput {
  readonly harnessSessionRowId: string;
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function closeSession(
  deps: CloseSessionDeps,
  input: CloseSessionInput
): Promise<void> {
  const { session, journal, sessionStatus } = deps;
  const { harnessSessionRowId } = input;

  // 1. Persist any remaining buffered chunks
  try {
    await journal.commit();
  } catch {
    // Best-effort — swallow transport errors on shutdown
  }

  // 2. Close the harness session
  await session.close();

  // 3. Optionally update the backend
  if (sessionStatus) {
    try {
      await sessionStatus.markClosed(harnessSessionRowId);
    } catch {
      // Best-effort — don't let a backend failure mask close success
    }
  }
}
