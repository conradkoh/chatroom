/**
 * Orchestrator: harness.resume → wire events → BufferedMessageStreamSink.
 *
 * Reattaches to an existing harness session after a daemon restart,
 * without creating a new worker row or re-associating the session.
 */

import type {
  DirectHarnessSessionEvent,
  FlushStrategy,
  HarnessSessionId,
  HarnessSessionRowId,
} from '../../domain/direct-harness/index.js';

import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../infrastructure/services/direct-harness/message-stream/index.js';

import type {
  SpawnWorkerBackend,
  SpawnWorkerDeps,
  WorkerHandle,
} from './spawn-worker.js';

import { buildWorkerHandle, createDefaultFlushStrategy, wireEventSink } from './internal.js';

// Re-export shared types for consumers of this module
export type { SpawnWorkerBackend, WorkerHandle };

// ─── Types ───────────────────────────────────────────────────────────────────

/** Dependencies for resumeWorker — identical surface to SpawnWorkerDeps. */
export type ResumeWorkerDeps = SpawnWorkerDeps;

/** Options for resuming an existing worker. */
export interface ResumeWorkerOptions {
  /** Existing backend worker id (returned by createWorker on original spawn). */
  readonly workerId: string;
  /** Existing harness session id (assigned by the harness on original spawn). */
  readonly harnessSessionId: string;
}

// ─── resumeWorker ─────────────────────────────────────────────────────────────

/**
 * Reattach to an existing harness session and re-wire the event pipeline.
 *
 * Does NOT call createWorker or associateHarnessSession — the worker row
 * already exists in the backend. Intended for daemon-restart recovery.
 *
 * If `harness.resume` throws (e.g. the harness process has died or the session
 * is not found in the store), the error propagates; no transport is created.
 */
export async function resumeWorker(
  deps: ResumeWorkerDeps,
  options: ResumeWorkerOptions
): Promise<WorkerHandle> {
  const { backend, sessionId, harness, chunkExtractor, nowFn = Date.now } = deps;
  const { workerId, harnessSessionId } = options;

  // 1. Reattach to the existing harness session
  const session = await harness.resumeSession(harnessSessionId as HarnessSessionId);

  // 2. Build the message transport + sink
  const transport = new ConvexMessageStreamTransport({ backend, sessionId });
  const sink = new BufferedMessageStreamSink({
    workerId: workerId as HarnessSessionRowId,
    transport,
    strategy: deps.flushStrategy ?? createDefaultFlushStrategy(),
    maxBufferItems: deps.bufferLimit,
    clock: nowFn,
  });

  // 3. Wire events from the resumed session through the extractor into the sink
  const unsubscribeEvents = wireEventSink(session, sink, chunkExtractor);

  return buildWorkerHandle(workerId, harnessSessionId, session, sink, unsubscribeEvents);
}
