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

import type { BoundHarness } from '../entities/bound-harness.js';
import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
} from '../entities/direct-harness-session.js';
import type { OpenCodeSessionId } from '../entities/harness-session.js';
import type { ExtractedChunk } from '../entities/turn-chunk.js';

export type { ExtractedChunk };

// Co-located from legacy session-repository.ts + output-repository.ts

export interface SessionRepository {
  associateOpenCodeSessionId(
    harnessSessionId: string,
    opencodeSessionId: string,
    sessionTitle: string
  ): Promise<void>;
  getOpenCodeSessionId(harnessSessionId: string): Promise<OpenCodeSessionId | undefined>;
  markClosed(harnessSessionId: string): Promise<void>;
  markIdle(harnessSessionId: string): Promise<void>;
  markFailed(harnessSessionId: string): Promise<void>;
  markActive(harnessSessionId: string): Promise<void>;
  markTurnProcessed(harnessSessionId: string, turnSeq: number): Promise<void>;
  setGenerating(harnessSessionId: string, isGenerating: boolean): Promise<void>;
  dequeueNext(harnessSessionId: string): Promise<{ content: string; seq: number } | null>;
  beginAssistantTurn(harnessSessionId: string): Promise<{ turnId: string; turnSeq: number }>;
  bindTurnMessageId(turnId: string, messageId: string): Promise<void>;
  finalizeAssistantTurn(turnId: string): Promise<void>;
  updateSessionTitle(harnessSessionId: string, title: string): Promise<void>;
}

export interface OutputChunk {
  readonly content: string;
  readonly timestamp: number;
  readonly messageId?: string | undefined;
  readonly partType?: 'text' | 'reasoning' | undefined;
}

export interface OutputRepository {
  appendChunks(harnessSessionRowId: string, chunks: readonly OutputChunk[]): Promise<void>;
}

// ─── Ports ────────────────────────────────────────────────────────────────────

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
  record(chunk: {
    content: string;
    timestamp: number;
    messageId?: string | undefined;
    partType?: 'text' | 'reasoning' | undefined;
  }): void;
  /** Drain any buffered chunks now. Resolves once all currently-buffered chunks are persisted. */
  flush(): Promise<void>;
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
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => ExtractedChunk | null;
  readonly nowFn?:( () => number) | undefined;
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
  readonly harnessSessionId: string;
  /** Harness name from the backend session row (e.g. cursor-sdk). */
  readonly harnessName: string;
  readonly opencodeSessionId: string;
  /** The workspace this session belongs to — used for inactivity tracking. */
  readonly workspaceId: string;
  readonly session: DirectHarnessSession;
  /** The journal bound to this session — needed for flush() before finalize. */
  journal: SessionJournal;
  /**
   * The current pending/streaming assistant turn for this session.
   * Set by dispatchPrompt on begin, bound on first chunk, cleared on finalize.
   */
  currentTurn: { turnId: string; messageId: string | null } | null;
  /** Flush remaining chunks and close the harness session. Idempotent. */
  close(): Promise<void>;
}

// ─── Use case function ────────────────────────────────────────────────────────

/** @deprecated Use daemon subscribers instead. */
export async function openSession(
  _deps: OpenSessionDeps,
  _input: OpenSessionInput
): Promise<SessionHandle> {
  throw new Error('openSession is deprecated');
}
