/**
 * Subscribes to pending harness sessions via Convex WS and orchestrates
 * harness boot + session open.
 *
 * Unlike the CLI `session open` command (which uses the domain `openSession`
 * use case end-to-end), this subscriber processes sessions that were already
 * created by the webapp. The backend row exists — we just need to spawn the
 * harness, open a session on it, wire the journal, and associate the IDs.
 */

import type { ConvexClient } from 'convex/browser';

import type { DirectHarnessSession } from './command-subscriber.js';
import { handleSessionIdle } from './idle-handler.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSessionEvent } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../../domain/direct-harness/entities/harness-session.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  JournalFactory,
  SessionHandle,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import {
  startOpencodeSdkHarness,
  createOpencodeSdkChunkExtractor,
} from '../../../../infrastructure/harnesses/opencode-sdk/index.js';

// ─── Convex shape types ──────────────────────────────────────────────────────

/** Shape of a pending session row from listPendingSessionsForMachine. */
interface PendingSession {
  _id: string;
  workspaceId: string;
  type: string;
  opencode?: {
    harnessName: string;
    lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
  };
}

/** Shape of the workspace lookup result. */
interface WorkspaceInfo {
  workingDir: string;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type ActiveSession = SessionHandle;

export interface SessionSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly journalFactory: JournalFactory;
}

export interface SessionSubscriberHandle {
  stop(): void;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startSessionSubscriber(
  daemonSession: DirectHarnessSession,
  wsClient: ConvexClient,
  deps: SessionSubscriberDeps
): SessionSubscriberHandle {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: daemonSession.sessionId,
      machineId: daemonSession.machineId,
    },
    (pendingSessions: PendingSession[] | null) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const session of pendingSessions) {
        const rowId = session._id;
        if (inFlight.has(rowId)) continue;
        inFlight.add(rowId);
        void processOne(daemonSession, deps, session).finally(() => inFlight.delete(rowId));
      }
    },
    (err: unknown) => {
      console.warn(
        '[direct-harness] Session subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

// ─── Per-session orchestration ───────────────────────────────────────────────

async function getOrCreateHarness(
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps,
  session: PendingSession,
  workspace: WorkspaceInfo
): Promise<BoundHarness> {
  let harness = deps.harnesses.get(session.workspaceId);
  if (harness && !harness.isAlive()) {
    console.warn(
      `[direct-harness] Harness for workspace ${session.workspaceId} is no longer alive — restarting`
    );
    harness.close().catch(() => {});
    deps.harnesses.delete(session.workspaceId);
    harness = undefined;
  }
  if (!harness) {
    harness = await startOpencodeSdkHarness({
      type: 'opencode',
      workingDir: workspace.workingDir,
      workspaceId: session.workspaceId,
      resolvedConvexUrl: daemonSession.convexUrl,
    });
    deps.harnesses.set(session.workspaceId, harness);
  }
  return harness;
}

function recordLiveSessionChunk(
  event: DirectHarnessSessionEvent,
  handle: SessionHandle,
  journal: ReturnType<JournalFactory['create']>,
  extractChunk: ReturnType<typeof createOpencodeSdkChunkExtractor>,
  deps: SessionSubscriberDeps
): void {
  const chunk = extractChunk(event);
  if (chunk === null) {
    return;
  }
  journal.record({
    content: chunk.content,
    timestamp: Date.now(),
    messageId: chunk.messageId,
    partType: chunk.partType,
  });
  if (handle.currentTurn && handle.currentTurn.messageId === null) {
    handle.currentTurn.messageId = chunk.messageId;
    deps.sessionRepository
      .bindTurnMessageId(handle.currentTurn.turnId, chunk.messageId)
      .catch((err: unknown) => console.warn('[direct-harness] bindTurnMessageId error:', err));
  }
}

function handleLiveSessionTitleUpdate(
  event: DirectHarnessSessionEvent,
  deps: SessionSubscriberDeps,
  rowId: string,
  liveSession: { sessionTitle?: string; setTitle?: (title: string) => void }
): void {
  if (event.type !== 'session.updated') {
    return;
  }
  const info = (event.payload as { info?: { title?: string } }).info;
  const newTitle = info?.title;
  if (!newTitle || newTitle === liveSession.sessionTitle) {
    return;
  }
  liveSession.setTitle?.(newTitle);
  void deps.sessionRepository
    .updateSessionTitle(rowId as string, newTitle)
    .catch((err: unknown) => console.warn('[direct-harness] updateSessionTitle error:', err));
}

function handleLiveSessionEvent(
  event: DirectHarnessSessionEvent,
  ctx: {
    handle: SessionHandle;
    journal: ReturnType<JournalFactory['create']>;
    extractChunk: ReturnType<typeof createOpencodeSdkChunkExtractor>;
    idleConfig: { agent: string; model?: { providerID: string; modelID: string } };
    deps: SessionSubscriberDeps;
    rowId: string;
    liveSession: { sessionTitle?: string; setTitle?: (title: string) => void };
  }
): void {
  const { handle, journal, extractChunk, idleConfig, deps, rowId, liveSession } = ctx;
  recordLiveSessionChunk(event, handle, journal, extractChunk, deps);
  if (event.type === 'session.idle') {
    void handleSessionIdle(handle, journal, idleConfig, deps.sessionRepository).catch(
      (err: unknown) => console.warn('[direct-harness] idle handler error:', err)
    );
  }
  handleLiveSessionTitleUpdate(event, deps, rowId, liveSession);
}

async function processOne(
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps,
  session: PendingSession
): Promise<void> {
  const rowId = session._id;

  try {
    // 1. Look up workspace to get workingDir
    const workspace = (await daemonSession.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: daemonSession.sessionId,
      workspaceId: session.workspaceId,
    })) as WorkspaceInfo | null;

    if (!workspace) {
      console.warn(
        `[direct-harness] Cannot open session ${rowId}: workspace ${session.workspaceId} not found`
      );
      await deps.sessionRepository.markFailed(rowId);
      return;
    }

    // 2. Get or create BoundHarness for this workspace
    const harness = await getOrCreateHarness(daemonSession, deps, session, workspace);

    // 3. Open a session on the harness
    const liveSession = await harness.newSession({
      agent: session.opencode?.lastUsedConfig.agent ?? 'build',
      harnessSessionId: rowId as unknown as HarnessSessionId,
    });

    // 5. Create journal + wire session events → journal
    const journal = deps.journalFactory.create(rowId);
    const extractChunk = createOpencodeSdkChunkExtractor(); // one stateful instance per session
    const idleConfig = {
      agent: session.opencode?.lastUsedConfig.agent ?? 'build',
      model: session.opencode?.lastUsedConfig.model,
    };

    // Declare handle early so event listener closure can reference it.
    // We use a mutable ref-wrapper so close() can also call unsubscribeEvents
    // which is assigned after handle.
    let unsubscribeEvents: () => void = () => {};

    // 6. Build idempotent close function
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      unsubscribeEvents();
      await journal.commit();
      await liveSession.close();
      await deps.sessionRepository.markClosed(rowId);
    };

    // 7. Store in shared registry BEFORE patching the DB so that
    //    prompt-subscriber can never observe the opencodeSessionId without
    //    also finding the handle (prevents a second competing connection).
    //    Declare handle early so the event listener closure can reference it.
    const handle: SessionHandle = {
      harnessSessionId: rowId,
      opencodeSessionId: liveSession.opencodeSessionId as string,
      workspaceId: session.workspaceId,
      session: liveSession,
      journal,
      currentTurn: null,
      close,
    };

    unsubscribeEvents = liveSession.onEvent((event) => {
      handleLiveSessionEvent(event, {
        handle,
        journal,
        extractChunk,
        idleConfig,
        deps,
        rowId,
        liveSession,
      });
    });

    deps.activeSessions.set(rowId, handle);

    // 8. Associate the harness-issued session ID with the existing backend row.
    //    This DB patch triggers pendingForMachine to re-fire — by this point
    //    activeSessions already has the handle so prompt-subscriber finds it
    //    directly without lazy-resuming.
    try {
      await deps.sessionRepository.associateOpenCodeSessionId(
        rowId,
        liveSession.opencodeSessionId as string,
        liveSession.sessionTitle
      );
    } catch (err) {
      deps.activeSessions.delete(rowId);
      await liveSession.close().catch(() => {});
      throw err;
    }

    console.log(
      `[direct-harness] Session opened: rowId=${rowId} agent=${session.opencode?.lastUsedConfig.agent ?? 'build'} workspace=${session.workspaceId}`
    );
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to open session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );
    // No opencodeSessionId was established, so there is nothing on disk to
    // resume. Mark as failed (permanent).
    try {
      await deps.sessionRepository.markFailed(rowId);
    } catch {
      // Best-effort
    }
  }
}
