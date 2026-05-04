/**
 * Domain use case: open a new harness session in a workspace.
 *
 * Orchestrates:
 *   1. Create a backend session row → harnessSessionRowId
 *   2. Resolve (or spawn) a harness process for the workspace
 *   3. Open a session on the running harness → DirectHarnessSession
 *   4. Associate the harness-issued session ID with the backend row
 *   5. Build a MessageStreamSink and wire it to session events
 *   6. Return a handle for prompt/close operations
 */

import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { DirectHarnessSpawner } from '../entities/direct-harness-spawner.js';
import type { FlushStrategy, MessageStreamSink, MessageStreamTransport } from '../ports/index.js';

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

/** Resolves a spawner for a workspace (may spawn a process on first call). */
export interface SpawnerProvider {
  getSpawner(workspaceId: string, workingDir: string): Promise<DirectHarnessSpawner>;
}

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface OpenSessionDeps {
  readonly sessionRepository: SessionRepository;
  readonly spawnerProvider: SpawnerProvider;
  readonly transport: MessageStreamTransport;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  readonly flushStrategy?: FlushStrategy;
  readonly nowFn?: () => number;
}

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface OpenSessionInput {
  readonly workspaceId: string;
  readonly workingDir: string;
  readonly harnessName: string;
  readonly agent: string;
}

export interface OpenSessionResult {
  readonly harnessSessionRowId: string;
  readonly harnessSessionId: string;
  readonly session: DirectHarnessSession;
  readonly sink: MessageStreamSink;
  /** Flush remaining chunks and close the harness session. Idempotent. */
  close(): Promise<void>;
}

// ─── Use case function ────────────────────────────────────────────────────────

export async function openSession(
  deps: OpenSessionDeps,
  input: OpenSessionInput
): Promise<OpenSessionResult> {
  throw new Error('Not implemented');
}
