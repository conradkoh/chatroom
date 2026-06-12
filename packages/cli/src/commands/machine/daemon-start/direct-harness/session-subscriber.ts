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
import { Effect } from 'effect';

import type { DirectHarnessSession } from './command-subscriber.js';
import { handleSessionIdle } from './idle-handler.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
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

/** Effect twin — open one pending harness session. */
// fallow-ignore-next-line unused-export
export const processOneSessionEffect = (
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps,
  session: PendingSession
): Effect.Effect<void, never, never> =>
  Effect.catchAll(
    Effect.gen(function* () {
      const rowId = session._id;

      // 1. Look up workspace to get workingDir
      const workspace = yield* Effect.tryPromise({
        try: () =>
          daemonSession.backend.query(api.workspaces.getWorkspaceById, {
            sessionId: daemonSession.sessionId,
            workspaceId: session.workspaceId,
          }) as Promise<WorkspaceInfo | null>,
        catch: (e) => e,
      });

      if (!workspace) {
        console.warn(
          `[direct-harness] Cannot open session ${rowId}: workspace ${session.workspaceId} not found`
        );
        yield* Effect.tryPromise({
          try: () => deps.sessionRepository.markFailed(rowId),
          catch: (e) => e,
        });
        return;
      }

      // 2. Get or create BoundHarness for this workspace
      let harness = deps.harnesses.get(session.workspaceId);
      if (harness && !harness.isAlive()) {
        const oldHarness = harness;
        console.warn(
          `[direct-harness] Harness for workspace ${session.workspaceId} is no longer alive — restarting`
        );
        yield* Effect.tryPromise({
          try: () => oldHarness.close(),
          catch: () => undefined,
        }).pipe(Effect.catchAll(() => Effect.void));
        deps.harnesses.delete(session.workspaceId);
        harness = undefined;
      }
      if (!harness) {
        harness = yield* Effect.tryPromise({
          try: () =>
            startOpencodeSdkHarness({
              type: 'opencode',
              workingDir: workspace.workingDir,
              workspaceId: session.workspaceId,
            }),
          catch: (e) => e,
        });
        deps.harnesses.set(session.workspaceId, harness);
      }

      // 3. Open a session on the harness
      const liveSession = yield* Effect.tryPromise({
        try: () =>
          harness.newSession({
            agent: session.opencode?.lastUsedConfig.agent ?? 'build',
            harnessSessionId: rowId as unknown as HarnessSessionId,
          }),
        catch: (e) => e,
      });

      // 5. Create journal + wire session events → journal
      const journal = deps.journalFactory.create(rowId);
      const extractChunk = createOpencodeSdkChunkExtractor();
      const idleConfig = {
        agent: session.opencode?.lastUsedConfig.agent ?? 'build',
        model: session.opencode?.lastUsedConfig.model,
      };

      let unsubscribeEvents: () => void = () => {};

      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        unsubscribeEvents();
        await journal.commit();
        await liveSession.close();
        await deps.sessionRepository.markClosed(rowId);
      };

      const handle: SessionHandle = {
        harnessSessionId: rowId,
        opencodeSessionId: liveSession.opencodeSessionId as string,
        workspaceId: session.workspaceId,
        session: liveSession,
        journal,
        currentTurn: null,
        close,
      };

      yield* Effect.sync(() => {
        unsubscribeEvents = liveSession.onEvent((event) => {
          const chunk = extractChunk(event);
          if (chunk !== null) {
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
                .catch((err: unknown) =>
                  console.warn('[direct-harness] bindTurnMessageId error:', err)
                );
            }
          }
          if (event.type === 'session.idle') {
            void handleSessionIdle(handle, journal, idleConfig, deps.sessionRepository).catch(
              (err: unknown) => console.warn('[direct-harness] idle handler error:', err)
            );
          }
          if (event.type === 'session.updated') {
            const info = (event.payload as { info?: { title?: string } }).info;
            const newTitle = info?.title;
            if (newTitle && newTitle !== liveSession.sessionTitle) {
              liveSession.setTitle?.(newTitle);
              void deps.sessionRepository
                .updateSessionTitle(rowId as string, newTitle)
                .catch((err: unknown) =>
                  console.warn('[direct-harness] updateSessionTitle error:', err)
                );
            }
          }
        });
      });

      deps.activeSessions.set(rowId, handle);

      // 8. Associate the harness-issued session ID with the existing backend row.
      yield* Effect.tapError(
        Effect.tryPromise({
          try: () =>
            deps.sessionRepository.associateOpenCodeSessionId(
              rowId,
              liveSession.opencodeSessionId as string,
              liveSession.sessionTitle
            ),
          catch: (e) => e,
        }),
        () =>
          Effect.gen(function* () {
            deps.activeSessions.delete(rowId);
            yield* Effect.tryPromise({
              try: () => liveSession.close(),
              catch: () => undefined,
            }).pipe(Effect.catchAll(() => Effect.void));
          })
      );

      yield* Effect.sync(() =>
        console.log(
          `[direct-harness] Session opened: rowId=${rowId} agent=${session.opencode?.lastUsedConfig.agent ?? 'build'} workspace=${session.workspaceId}`
        )
      );
    }),
    (err) =>
      Effect.gen(function* () {
        const rowId = session._id;
        console.warn(
          `[direct-harness] Failed to open session ${rowId}:`,
          err instanceof Error ? err.message : String(err)
        );
        yield* Effect.tryPromise({
          try: () => deps.sessionRepository.markFailed(rowId),
          catch: () => undefined,
        }).pipe(Effect.catchAll(() => Effect.void));
      })
  );

async function processOne(
  daemonSession: DirectHarnessSession,
  deps: SessionSubscriberDeps,
  session: PendingSession
): Promise<void> {
  return Effect.runPromise(processOneSessionEffect(daemonSession, deps, session));
}
