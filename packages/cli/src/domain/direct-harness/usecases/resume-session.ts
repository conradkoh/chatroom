/**
 * Domain use case: resume an existing harness session after a daemon restart.
 *
 * Does NOT create a new backend row or re-associate — the session already exists.
 */

import type { OpenCodeSessionId, HarnessSessionId } from '../entities/harness-session.js';
import type { DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type {
  SessionHandle,
  SessionJournal,
  JournalFactory,
  ExtractedChunk,
} from './open-session.js';
import { closeSession } from './close-session.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ResumeSessionDeps {
  readonly harness: BoundHarness;
  readonly journalFactory: JournalFactory;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => ExtractedChunk | null;
  readonly nowFn?: () => number;
}

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface ResumeSessionInput {
  readonly harnessSessionId: string;
  readonly opencodeSessionId: string;
  readonly workspaceId?: string;
}

export type ResumeSessionResult = SessionHandle;

// ─── Use case function ────────────────────────────────────────────────────────

export async function resumeSession(
  deps: ResumeSessionDeps,
  input: ResumeSessionInput
): Promise<ResumeSessionResult> {
  const { harness, journalFactory, chunkExtractor, nowFn = Date.now } = deps;
  const { harnessSessionId, opencodeSessionId } = input;

  // 1. Reconnect to the harness session
  const session = await harness.resumeSession(opencodeSessionId as OpenCodeSessionId, {
    harnessSessionId: harnessSessionId as HarnessSessionId,
  });

  // 2. Create a journal to record output chunks
  const journal = journalFactory.create(harnessSessionId);

  // 3. Wire session events through the chunk extractor into the journal
  const unsubscribeEvents = session.onEvent((event) => {
    const chunk = chunkExtractor(event);
    if (chunk !== null) {
      journal.record({
        content: chunk.content,
        timestamp: nowFn(),
        messageId: chunk.messageId,
        partType: chunk.partType,
      });
      // Set messageId on the current pending turn so the infrastructure layer
      // can call bindTurnMessageId (domain layer has no sessionRepository dep).
      if (handle.currentTurn && handle.currentTurn.messageId === null) {
        handle.currentTurn.messageId = chunk.messageId;
      }
    }
  });

  // 4. Build the idempotent close function
  let closed = false;

  const handle: SessionHandle = {
    harnessSessionId,
    opencodeSessionId,
    workspaceId: input.workspaceId ?? '',
    session,
    journal,
    currentTurn: null,

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      await closeSession({ session, journal }, { harnessSessionId });
    },
  };

  return handle;
}
