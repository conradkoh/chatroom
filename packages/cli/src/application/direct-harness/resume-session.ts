/**
 * Application use case: resume an existing harness session after a daemon restart.
 *
 * Reattaches to the running harness session without creating a new backend row
 * or re-associating the session. The harness process is assumed to still be alive.
 */

import { buildSessionHandle, createDefaultFlushStrategy, wireEventSink } from './internal.js';
import type { OpenSessionBackend, SessionHandle } from './open-session.js';
import type {
  DirectHarnessSessionEvent,
  FlushStrategy,
  HarnessSessionId,
  HarnessSessionRowId,
 DirectHarnessSpawner } from '../../domain/direct-harness/index.js';
import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../infrastructure/services/direct-harness/message-stream/index.js';


// ─── Types ───────────────────────────────────────────────────────────────────

/** Dependencies for resumeSession — surface compatible with OpenSessionDeps. */
export interface ResumeSessionDeps {
  readonly backend: OpenSessionBackend;
  readonly sessionId: string;
  /** Spawner to reconnect to the existing harness process. */
  readonly spawner: DirectHarnessSpawner;
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  readonly flushStrategy?: FlushStrategy;
  readonly bufferLimit?: number;
  readonly nowFn?: () => number;
}

/** Options for resuming an existing harness session. */
export interface ResumeSessionOptions {
  /** Backend row ID of the session to resume. */
  readonly harnessSessionRowId: string;
  /** Harness-issued session ID (assigned by opencode on original spawn). */
  readonly harnessSessionId: string;
}

// Re-export shared types
export type { OpenSessionBackend, SessionHandle };

// ─── resumeSession ────────────────────────────────────────────────────────────

/**
 * Reattach to an existing harness session and re-wire the event pipeline.
 *
 * Does NOT call openSession or associateHarnessSessionId — the backend row
 * already exists. Intended for daemon-restart recovery.
 *
 * If `spawner.resumeSession` throws (e.g. the harness process has died or the
 * session is not found in the store), the error propagates without creating
 * a transport.
 */
export async function resumeSession(
  deps: ResumeSessionDeps,
  options: ResumeSessionOptions
): Promise<SessionHandle> {
  const { backend, sessionId, spawner, chunkExtractor, nowFn = Date.now } = deps;
  const { harnessSessionRowId, harnessSessionId } = options;

  // 1. Reattach to the existing harness session
  const session = await spawner.resumeSession(harnessSessionId as HarnessSessionId);

  // 2. Build the message transport + sink
  const transport = new ConvexMessageStreamTransport({ backend, sessionId });
  const sink = new BufferedMessageStreamSink({
    workerId: harnessSessionRowId as HarnessSessionRowId,
    transport,
    strategy: deps.flushStrategy ?? createDefaultFlushStrategy(),
    maxBufferItems: deps.bufferLimit,
    clock: nowFn,
  });

  // 3. Wire events from the resumed session through the extractor into the sink
  const unsubscribeEvents = wireEventSink(session, sink, chunkExtractor);

  return buildSessionHandle(harnessSessionRowId, harnessSessionId, session, sink, unsubscribeEvents);
}
