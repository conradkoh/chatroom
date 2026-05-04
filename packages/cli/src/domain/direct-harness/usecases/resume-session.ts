/**
 * Domain use case: resume an existing harness session after a daemon restart.
 *
 * Orchestrates:
 *   1. Reconnect to the running harness process via the spawner
 *   2. Rebuild a MessageStreamSink and rewire session events
 *   3. Return a handle for prompt/close operations
 *
 * Does NOT create a new backend row or re-associate — the session already exists.
 */

import type { DirectHarnessSession, DirectHarnessSessionEvent } from '../entities/direct-harness-session.js';
import type { DirectHarnessSpawner } from '../entities/direct-harness-spawner.js';
import type { FlushStrategy, MessageStreamSink, MessageStreamTransport } from '../ports/index.js';

// ─── Deps ─────────────────────────────────────────────────────────────────────

export interface ResumeSessionDeps {
  readonly spawner: DirectHarnessSpawner;
  readonly transport: MessageStreamTransport;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  readonly flushStrategy?: FlushStrategy;
  readonly nowFn?: () => number;
}

// ─── Input / Result ───────────────────────────────────────────────────────────

export interface ResumeSessionInput {
  readonly harnessSessionRowId: string;
  readonly harnessSessionId: string;
}

export type ResumeSessionResult = import('./open-session.js').OpenSessionResult;

// ─── Use case function ────────────────────────────────────────────────────────

export async function resumeSession(
  deps: ResumeSessionDeps,
  input: ResumeSessionInput
): Promise<ResumeSessionResult> {
  throw new Error('Not implemented');
}
