/**
 * Domain use case: open a new harness session in a workspace.
 *
 * Orchestrates:
 *   1. Create a backend session row → harnessSessionRowId
 *   2. Resolve (or spawn) a BoundHarness for the workspace
 *   3. Start a session on the harness → DirectHarnessSession
 *   4. Associate the harness-issued session ID with the backend row
 *   5. Create a SessionJournal to record output chunks
 *   6. Wire session events through the chunk extractor into the journal
 *   7. Return a SessionHandle for prompt / close operations
 *
 * If association (step 4) fails the harness session is closed immediately
 * to avoid leaking processes.
 */

import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { BoundHarness } from '../entities/bound-harness.js';
import type { HarnessSessionRowId } from '../entities/harness-session.js';
import { closeSession } from './close-session.js';

// ─── Ports ────────────────────────────────────────────────────────────────────

/** Backend persistence for session lifecycle. */
export interface SessionRepository {
  createSession(
    workspaceId: string,
    harnessName: string,
    config: { agent: string }
  ): Promise<{ harnessSessionRowId: string }>;

  associateHarnessSessionId(
    harnessSessionRowId: string,
    harnessSessionId: string,
    sessionTitle: string
  ): Promise<void>;
}

/** Resolves a BoundHarness for a workspace (may spawn a process on first call). */
export interface SpawnerProvider {
  getSpawner(workspaceId: string, workingDir: string): Promise<BoundHarness>;
}

/**
 * A journal that records output chunks produced by a harness session.
 * The use case calls `record()` for each chunk extracted from session events,
 * and `commit()` to persist all recorded chunks (typically on close).
 */
export interface SessionJournal {
  record(chunk: { content: string; timestamp: number }): void;
  commit(): Promise<void>;
}

/** Creates a SessionJournal bound to a specific backend session row. */
export interface JournalFactory {
  create(harnessSessionRowId: string): SessionJournal;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface OpenSessionDeps {
  readonly sessionRepository: SessionRepository;
  readonly spawnerProvider: SpawnerProvider;
  readonly journalFactory: JournalFactory;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  readonly nowFn?: () => number;
}

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface OpenSessionInput {
  readonly workspaceId: string;
  readonly workingDir: string;
  readonly harnessName: string;
  readonly agent: string;
}

/**
 * Handle to a live harness session. Callers can send prompts via `.session`
 * and must call `.close()` when done to flush remaining chunks and release
 * resources. Close is idempotent.
 */
export interface SessionHandle {
  readonly harnessSessionRowId: string;
  readonly harnessSessionId: string;
  readonly session: DirectHarnessSession;
  /** Flush remaining chunks and close the harness session. Idempotent. */
  close(): Promise<void>;
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function openSession(
  deps: OpenSessionDeps,
  input: OpenSessionInput
): Promise<SessionHandle> {
  const { sessionRepository, spawnerProvider, journalFactory, chunkExtractor, nowFn = Date.now } = deps;
  const { workspaceId, workingDir, harnessName, agent } = input;

  // 1. Create backend session row
  const { harnessSessionRowId } = await sessionRepository.createSession(
    workspaceId,
    harnessName,
    { agent }
  );

  // 2. Get or spawn a BoundHarness for this workspace
  const harness = await spawnerProvider.getSpawner(workspaceId, workingDir);

  // 3. Start a session on the harness
  const session = await harness.newSession({
    agent,
    harnessSessionRowId: harnessSessionRowId as HarnessSessionRowId,
  });

  // 4. Associate the harness-issued session ID with the backend row.
  //    Roll back by closing the session if this fails.
  try {
    await sessionRepository.associateHarnessSessionId(
      harnessSessionRowId,
      session.harnessSessionId as string,
      session.sessionTitle
    );
  } catch (err) {
    await session.close().catch(() => {});
    throw err;
  }

  // 5. Create a journal to record output chunks
  const journal = journalFactory.create(harnessSessionRowId);

  // 6. Wire session events through the chunk extractor into the journal
  const unsubscribeEvents = session.onEvent((event) => {
    const content = chunkExtractor(event);
    if (content !== null) {
      journal.record({ content, timestamp: nowFn() });
    }
  });

  // 7. Build the idempotent close function
  let closed = false;

  return {
    harnessSessionRowId,
    harnessSessionId: session.harnessSessionId as string,
    session,

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      // Stop listening so no more records are written during shutdown
      unsubscribeEvents();

      // Delegate to the closeSession use case for journal + session lifecycle
      await closeSession(
        { session, journal },
        { harnessSessionRowId }
      );
    },
  };
}
