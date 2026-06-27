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

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
} from '../entities/direct-harness-session.js';

// ─── Extracted chunk ─────────────────────────────────────────────────────────

/**
 * A typed chunk of content extracted from a harness session event.
 *
 * Defined here (domain layer) so infrastructure can import the type without
 * inverting the dependency direction.
 */
export interface ExtractedChunk {
  /** The incremental text content of this chunk. */
  readonly content: string;
  /** The opencode SDK messageID — groups all tokens of one agent response into a turn. */
  readonly messageId: string;
  /** Whether this chunk is reasoning (thinking) or regular text output. */
  readonly partType: 'text' | 'reasoning';
}
import type { BoundHarness } from '../entities/bound-harness.js';
import type { HarnessSessionId } from '../entities/harness-session.js';
import type { SessionRepository } from '../ports/session-repository.js';

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
    messageId?: string;
    partType?: 'text' | 'reasoning';
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
  readonly harnessSessionId: string;
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
