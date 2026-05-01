/**
 * Shared internal helpers for the direct-harness application orchestrators.
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

import type { WorkerHandle } from './spawn-worker.js';

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

// ─── WorkerHandle builder ─────────────────────────────────────────────────────

/** Build a WorkerHandle with idempotent close(). */
export function buildWorkerHandle(
  workerId: string,
  harnessSessionId: string,
  session: DirectHarnessSession,
  sink: BufferedMessageStreamSink,
  unsubscribeEvents: () => void
): WorkerHandle {
  let closed = false;

  return {
    workerId,
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
