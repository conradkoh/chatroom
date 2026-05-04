/**
 * Domain use case: resume an existing harness session after a daemon restart.
 *
 * Orchestrates:
 *   1. Reconnect to the running harness process via BoundHarness.resumeSession()
 *   2. Create a SessionJournal via JournalFactory
 *   3. Wire session events through the chunk extractor into the journal
 *   4. Return a SessionHandle for prompt / close operations
 *
 * Does NOT create a new backend row or re-associate — the session already exists.
 */

import type { HarnessSessionId, HarnessSessionRowId } from '../entities/harness-session.js';
import type { DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type { SessionHandle, SessionJournal, JournalFactory } from './open-session.js';
import { closeSession } from './close-session.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ResumeSessionDeps {
  readonly harness: BoundHarness;
  readonly journalFactory: JournalFactory;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  readonly nowFn?: () => number;
}

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface ResumeSessionInput {
  readonly harnessSessionRowId: string;
  readonly harnessSessionId: string;
}

export type ResumeSessionResult = SessionHandle;

// ─── Use case function ────────────────────────────────────────────────────────

export async function resumeSession(
  deps: ResumeSessionDeps,
  input: ResumeSessionInput
): Promise<ResumeSessionResult> {
  const { harness, journalFactory, chunkExtractor, nowFn = Date.now } = deps;
  const { harnessSessionRowId, harnessSessionId } = input;

  // 1. Reconnect to the harness session
  const session = await harness.resumeSession(harnessSessionId as HarnessSessionId, {
    harnessSessionRowId: harnessSessionRowId as HarnessSessionRowId,
  });

  // 2. Create a journal to record output chunks
  const journal = journalFactory.create(harnessSessionRowId);

  // 3. Wire session events through the chunk extractor into the journal
  const unsubscribeEvents = session.onEvent((event) => {
    const content = chunkExtractor(event);
    if (content !== null) {
      journal.record({ content, timestamp: nowFn() });
    }
  });

  // 4. Build the idempotent close function
  let closed = false;

  return {
    harnessSessionRowId,
    harnessSessionId,
    session,

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      // Stop listening so no more records are written during shutdown
      unsubscribeEvents();

      // Delegate to closeSession for journal + session lifecycle
      await closeSession(
        { session, journal },
        { harnessSessionRowId }
      );
    },
  };
}
