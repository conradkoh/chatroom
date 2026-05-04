/**
 * Domain use case: close a harness session gracefully.
 *
 * Orchestrates:
 *   1. Commit the journal to persist any remaining buffered chunks
 *   2. Close the harness session via DirectHarnessSession.close()
 *   3. Mark the session as closed in the backend
 *
 * This is the building block used internally by SessionHandle.close().
 * Callers that hold a SessionHandle should call handle.close() directly;
 * this use case is for scenarios where you have the raw session + journal
 * but weren't created through openSession (e.g. manual or testing paths).
 */

import type { DirectHarnessSession } from '../entities/direct-harness-session.js';
import type { SessionRepository } from '../ports/session-repository.js';
import type { SessionJournal } from './open-session.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface CloseSessionDeps {
  readonly session: DirectHarnessSession;
  readonly journal: SessionJournal;
  readonly sessionRepository?: SessionRepository;
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
  const { session, journal, sessionRepository } = deps;
  const { harnessSessionRowId } = input;

  // 1. Persist any remaining buffered chunks
  try {
    await journal.commit();
  } catch {
    // Best-effort — swallow transport errors on shutdown
  }

  // 2. Close the harness session
  await session.close();

  // 3. Mark closed in the backend
  if (sessionRepository) {
    try {
      await sessionRepository.markClosed(harnessSessionRowId);
    } catch {
      // Best-effort — don't let a backend failure mask close success
    }
  }
}
