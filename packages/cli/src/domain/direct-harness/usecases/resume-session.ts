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

import type { DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type { SessionHandle, SessionJournal, JournalFactory } from './open-session.js';

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
  throw new Error('Not implemented');
}
