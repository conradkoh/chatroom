/**
 * Orchestrator: createWorker → harness.spawn → associateHarnessSession.
 *
 * Wires harness session events through a BufferedMessageStreamSink backed
 * by ConvexMessageStreamTransport → backend appendMessages mutation.
 */

import type {
  DirectHarnessSpawner,
  DirectHarnessSession,
  DirectHarnessSessionEvent,
  FlushStrategy,
  HarnessSessionRowId,
} from '../../domain/direct-harness/index.js';

import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../infrastructure/services/direct-harness/message-stream/index.js';

import { api } from '../../api.js';
import { buildWorkerHandle, createDefaultFlushStrategy, wireEventSink } from './internal.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal backend interface required by the orchestrator. */
export interface SpawnWorkerBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
}

/** Dependencies for spawnWorker. */
export interface SpawnWorkerDeps {
  /** Authenticated backend client (e.g. DaemonContext.deps.backend). */
  readonly backend: SpawnWorkerBackend;
  /** CLI auth session id. */
  readonly sessionId: string;
  /** Harness spawner to use. */
  readonly harness: DirectHarnessSpawner;
  /**
   * Extracts text content from a harness event.
   * Returns the content string to append, or null to skip the event
   * (e.g. tool-call events, metadata events, etc.).
   */
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  /** Flush strategy for the message sink. Default: Composite([Interval(500ms), Sentence()]). */
  readonly flushStrategy?: FlushStrategy;
  /** Max items in the message buffer before drop-oldest. Default: 1000. */
  readonly bufferLimit?: number;
  /** Clock injection for testing. Default: Date.now. */
  readonly nowFn?: () => number;
}

/** Options for opening a new session. */
export interface SpawnWorkerOptions {
  /** Chatroom the worker is associated with (Convex Id<'chatroom_rooms'> as string). */
  readonly chatroomId: string;
  /** Machine the worker runs on. */
  readonly machineId: string;
  /** Role or label associated with the worker. */
  readonly role: string;
  /** Working directory for the harness process. */
  readonly cwd?: string;
  /** Additional environment variables. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A live worker with its session and message sink. */
export interface WorkerHandle {
  /** Backend-issued worker identifier. */
  readonly workerId: string;
  /** Harness-issued session identifier. */
  readonly harnessSessionId: string;
  /** The live harness session — use send() to forward messages. */
  readonly session: DirectHarnessSession;
  /**
   * Flush any pending message chunks and close the harness session.
   * Idempotent — safe to call multiple times.
   */
  close(): Promise<void>;
}

// ─── spawnWorker ─────────────────────────────────────────────────────────────

/**
 * Create a new worker, spawn a harness session, associate the two, and
 * wire harness events through to the backend via a buffered message sink.
 *
 * If `associateHarnessSession` fails after the harness has been spawned,
 * the session is closed immediately to avoid leaking processes the backend
 * doesn't know about.
 */
export async function spawnWorker(
  deps: SpawnWorkerDeps,
  options: SpawnWorkerOptions
): Promise<WorkerHandle> {
  const { backend, sessionId, harness, chunkExtractor, nowFn = Date.now } = deps;
  const { chatroomId, machineId, role, cwd, env } = options;

  // 1. Create backend worker record → get workerId
  const { workerId } = await backend.mutation(
    api.chatroom.workers.mutations.createWorker,
    { sessionId, chatroomId, harnessName: harness.harnessName }
  );

  // 2. Open a harness session
  const session = await harness.openSession({
    cwd,
    env,
    config: { chatroomId, machineId, role },
  });

  // 3. Associate the harness session with the backend worker.
  //    If this fails, close the session to avoid leaking processes.
  try {
    await backend.mutation(
      api.chatroom.workers.mutations.associateHarnessSession,
      { sessionId, workerId, harnessSessionId: session.harnessSessionId as string }
    );
  } catch (err) {
    await session.close().catch(() => {});
    throw err;
  }

  // 4. Build the message transport + sink
  const transport = new ConvexMessageStreamTransport({ backend, sessionId });
  const sink = new BufferedMessageStreamSink({
    workerId: workerId as HarnessSessionRowId,
    transport,
    strategy: deps.flushStrategy ?? createDefaultFlushStrategy(),
    maxBufferItems: deps.bufferLimit,
    clock: nowFn,
  });

  // 5. Wire events from the session through the chunk extractor into the sink
  const unsubscribeEvents = wireEventSink(session, sink, chunkExtractor);

  return buildWorkerHandle(workerId, session.harnessSessionId as string, session, sink, unsubscribeEvents);
}
