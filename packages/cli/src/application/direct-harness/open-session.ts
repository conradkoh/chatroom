/**
 * Application use case: open a new harness session in a workspace.
 *
 * Orchestrates:
 *   1. backend.openSession → harnessSessionRowId
 *   2. harnessRegistry.getOrSpawn(workspaceId, cwd) → HarnessProcess
 *   3. harnessProcess.spawner.openSession({ agent }) → DirectHarnessSession
 *   4. backend.associateHarnessSessionId
 *   5. Wire session events → BufferedMessageStreamSink → ConvexMessageStreamTransport
 */



import type { HarnessProcessRegistry } from './get-or-spawn-harness.js';
import { buildSessionHandle, createDefaultFlushStrategy, wireEventSink } from './internal.js';
import type { SessionHandle } from './internal.js';
import { api } from '../../api.js';
import type {
  DirectHarnessSessionEvent,
  FlushStrategy,
  HarnessSessionRowId,
} from '../../domain/direct-harness/index.js';
import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../infrastructure/services/direct-harness/message-stream/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Minimal backend interface required by the orchestrator. */
export interface OpenSessionBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mutation: (endpoint: any, args: any) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: (endpoint: any, args: any) => Promise<any>;
}

/** Dependencies for openSession. */
export interface OpenSessionDeps {
  /** Authenticated backend client. */
  readonly backend: OpenSessionBackend;
  /** CLI auth session id. */
  readonly sessionId: string;
  /** Registry that provides one harness process per workspace. */
  readonly harnessRegistry: HarnessProcessRegistry;
  /**
   * Extracts text content from a harness event.
   * Returns the content string to append, or null to skip the event.
   */
  readonly chunkExtractor: (event: DirectHarnessSessionEvent) => string | null;
  /** Flush strategy for the message sink. Default: Composite([Interval(500ms), Sentence()]). */
  readonly flushStrategy?: FlushStrategy;
  /** Max items in the message buffer before drop-oldest. Default: 1000. */
  readonly bufferLimit?: number;
  /** Clock injection for testing. Default: Date.now. */
  readonly nowFn?: () => number;
}

/** Options for opening a new harness session. */
export interface OpenSessionOptions {
  /** Convex Id of the workspace. */
  readonly workspaceId: string;
  /** Working directory of the workspace (for harness process spawning). */
  readonly workingDir: string;
  /** Harness implementation name (e.g. 'opencode-sdk'). */
  readonly harnessName: string;
  /** The agent role opening this session (e.g. 'builder', 'planner'). */
  readonly agent: string;
}

// Re-export for consumers
export type { SessionHandle };

// ─── openSession ─────────────────────────────────────────────────────────────

/**
 * Open a new harness session in a workspace.
 *
 * If `associateHarnessSessionId` fails after the harness session has been
 * opened, the session is closed immediately to avoid leaking processes.
 */
export async function openSession(
  deps: OpenSessionDeps,
  options: OpenSessionOptions
): Promise<SessionHandle> {
  const { backend, sessionId, harnessRegistry, chunkExtractor, nowFn = Date.now } = deps;
  const { workspaceId, workingDir, harnessName, agent } = options;

  // 1. Create backend session row → get harnessSessionRowId
  //    CLI path: opens a session without a first prompt (no firstPrompt).
  const { harnessSessionRowId } = await backend.mutation(
    api.chatroom.directHarness.sessions.openSession,
    { sessionId, workspaceId, harnessName, config: { agent } }
  );

  // 2. Get or spawn the harness process for this workspace
  const harnessProcess = await harnessRegistry.getOrSpawn(workspaceId, workingDir);

  // 3. Open a session on the running harness process
  const session = await harnessProcess.spawner.openSession({
    config: { agent },
  });

  // 4. Associate the harness-issued session ID with the backend row.
  //    Sync the session title from the harness so the sidebar shows it.
  //    If this fails, close the session to avoid leaking processes.
  try {
    await backend.mutation(
      api.chatroom.directHarness.sessions.associateHarnessSessionId,
      {
        sessionId,
        harnessSessionRowId,
        harnessSessionId: session.harnessSessionId as string,
        sessionTitle: session.sessionTitle,
      }
    );
  } catch (err) {
    await session.close().catch(() => {});
    throw err;
  }

  // 5. Build message transport + sink
  const transport = new ConvexMessageStreamTransport({ backend, sessionId });
  const sink = new BufferedMessageStreamSink({
    workerId: harnessSessionRowId as HarnessSessionRowId,
    transport,
    strategy: deps.flushStrategy ?? createDefaultFlushStrategy(),
    maxBufferItems: deps.bufferLimit,
    clock: nowFn,
  });

  // 6. Wire session events through the chunk extractor into the sink
  const unsubscribeEvents = wireEventSink(session, sink, chunkExtractor);

  return buildSessionHandle(harnessSessionRowId, session.harnessSessionId as string, session, sink, unsubscribeEvents);
}
