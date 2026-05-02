/**
 * Shared internal helpers for the direct-harness application use cases.
 * Not exported from the public barrel — for internal use only.
 */

import type {
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  FlushStrategy,
} from '../../domain/direct-harness/index.js';

import {
  BufferedMessageStreamSink,
  CompositeFlushStrategy,
  IntervalFlushStrategy,
  SentenceFlushStrategy,
} from '../../infrastructure/services/direct-harness/message-stream/index.js';

// ─── Session handle ───────────────────────────────────────────────────────────

/** A live harness session with its message sink. */
export interface SessionHandle {
  /** Backend-issued session row identifier (harnessSessionRowId). */
  readonly harnessSessionRowId: string;
  /** Harness-issued session identifier (opencode-issued). */
  readonly harnessSessionId: string;
  /** The live harness session — use prompt() to forward messages. */
  readonly session: DirectHarnessSession;
  /**
   * Flush any pending message chunks and close the harness session.
   * Idempotent — safe to call multiple times.
   */
  close(): Promise<void>;
}

// ─── Default flush strategy ───────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 500;

export function createDefaultFlushStrategy(): FlushStrategy {
  return new CompositeFlushStrategy([
    new IntervalFlushStrategy(DEFAULT_INTERVAL_MS),
    new SentenceFlushStrategy(),
  ]);
}

// ─── Event wiring ─────────────────────────────────────────────────────────────

/**
 * Subscribe to session events and forward text chunks to the sink.
 * Returns an unsubscribe function.
 */
export function wireEventSink(
  session: DirectHarnessSession,
  sink: BufferedMessageStreamSink,
  chunkExtractor: (event: DirectHarnessSessionEvent) => string | null
): () => void {
  return session.onEvent((event) => {
    const content = chunkExtractor(event);
    if (content !== null) {
      sink.write({ content });
    }
  });
}

// ─── Session handle builder ───────────────────────────────────────────────────

/** Build a SessionHandle with idempotent close(). */
export function buildSessionHandle(
  harnessSessionRowId: string,
  harnessSessionId: string,
  session: DirectHarnessSession,
  sink: BufferedMessageStreamSink,
  unsubscribeEvents: () => void
): SessionHandle {
  let closed = false;

  return {
    harnessSessionRowId,
    harnessSessionId,
    session,
    async close() {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      try {
        await sink.flush();
      } catch {
        // Best-effort flush on shutdown — swallow transport errors
      }
      await session.close();
    },
  };
}
