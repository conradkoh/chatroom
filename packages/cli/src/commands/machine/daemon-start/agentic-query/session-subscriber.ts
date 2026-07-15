import type { ConvexClient } from 'convex/browser';

import type { DirectHarnessSession } from '../direct-harness/command-subscriber.js';
import { handleSessionIdle } from '../direct-harness/idle-handler.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { DirectHarnessSessionEvent } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { HarnessSessionId } from '../../../../domain/direct-harness/entities/harness-session.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type {
  ExtractedChunk,
  JournalFactory,
  SessionHandle,
} from '../../../../domain/direct-harness/usecases/open-session.js';
import { makeHarnessKey } from '../../../../infrastructure/harnesses/harness-key.js';
import {
  createChunkExtractor,
  startBoundHarness,
  type NativeDirectHarnessName,
} from '../../../../infrastructure/harnesses/registry.js';
import { isOpenCodeSessionEventType } from '../../../../infrastructure/services/remote-agents/opencode-sdk/opencode-session-events.js';
import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';

interface PendingSession {
  _id: string;
  workspaceId: string;
  opencode?: {
    harnessName?: string;
    lastUsedConfig?: { agent: string; model?: { providerID: string; modelID: string } };
  };
}

interface SubscriberDeps {
  activeSessions: Map<string, ActiveSession>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
}

export function startSessionSubscriber(
  daemonSession: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: SubscriberDeps
): { stop: () => void } {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.daemon.agenticQuery.sessions.pendingForMachine,
    { sessionId: daemonSession.sessionId, machineId: daemonSession.machineId },
    (pendingSessions: unknown[]) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const doc of pendingSessions) {
        const session = doc as PendingSession;
        const rowId = session._id;
        if (inFlight.has(rowId)) continue;
        inFlight.add(rowId);
        void processOne(daemonSession, deps, session).finally(() => inFlight.delete(rowId));
      }
    },
    (err: unknown) => {
      console.warn(
        '[agentic-query] Session subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

async function getOrCreateHarness(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: SubscriberDeps,
  session: PendingSession,
  workspace: { workingDir: string }
): Promise<BoundHarness> {
  const harnessName = session.opencode?.harnessName ?? 'opencode-sdk';
  const key = makeHarnessKey(session.workspaceId, harnessName);
  let harness = deps.harnesses.get(key);
  if (harness && !harness.isAlive()) {
    console.warn(
      `[agentic-query] Harness ${harnessName} for ${session.workspaceId} dead — restarting`
    );
    harness.close().catch(() => {});
    deps.harnesses.delete(key);
    harness = undefined;
  }
  if (!harness) {
    harness = await startBoundHarness({
      harnessName: harnessName as NativeDirectHarnessName,
      workingDir: workspace.workingDir,
      workspaceId: session.workspaceId,
      resolvedConvexUrl: daemonSession.convexUrl,
    });
    deps.harnesses.set(key, harness);
  }
  return harness;
}

async function processOne(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: SubscriberDeps,
  session: PendingSession
): Promise<void> {
  const rowId = session._id;

  try {
    const workspace = (await daemonSession.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: daemonSession.sessionId,
      workspaceId: session.workspaceId,
    })) as { workingDir: string } | null;

    if (!workspace) {
      console.warn(
        `[agentic-query] Workspace ${session.workspaceId} not found for session ${rowId}`
      );
      await deps.sessionRepository.markFailed(rowId);
      return;
    }

    const harnessName = session.opencode?.harnessName ?? 'opencode-sdk';
    const harness = await getOrCreateHarness(daemonSession, deps, session, workspace);

    const modelConfig = session.opencode?.lastUsedConfig?.model;
    const model = modelConfig ? `${modelConfig.providerID}/${modelConfig.modelID}` : undefined;

    const liveSession = await harness.newSession({
      agent: session.opencode?.lastUsedConfig?.agent ?? 'build',
      model,
      harnessSessionId: rowId as unknown as HarnessSessionId,
    });

    const journal = deps.journalFactory.create(rowId);
    const extractChunk = createChunkExtractor(harness.type);
    const idleConfig = {
      agent: session.opencode?.lastUsedConfig?.agent ?? 'build',
      model: session.opencode?.lastUsedConfig?.model,
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
      deps.activeSessions.delete(rowId);
    };

    const handle: SessionHandle = {
      harnessSessionId: rowId,
      harnessName,
      opencodeSessionId: liveSession.opencodeSessionId as string,
      workspaceId: session.workspaceId,
      session: liveSession,
      journal,
      currentTurn: null,
      close,
    };

    unsubscribeEvents = liveSession.onEvent((event: DirectHarnessSessionEvent) => {
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
            .catch((err: unknown) => console.warn('[agentic-query] bindTurnMessageId error:', err));
        }
      }
      if (event.type === 'session.idle') {
        void handleSessionIdle(handle, journal, idleConfig, deps.sessionRepository).catch(
          (err: unknown) => console.warn('[agentic-query] idle handler error:', err)
        );
      }
      if (isOpenCodeSessionEventType(event.type) && event.type === 'session.updated') {
        const info = (event.payload as { info?: { title?: string } }).info;
        if (info?.title) {
          deps.sessionRepository
            .updateSessionTitle(rowId, info.title)
            .catch((err: unknown) =>
              console.warn('[agentic-query] updateSessionTitle error:', err)
            );
        }
      }
    });

    deps.activeSessions.set(rowId, handle);

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
      `[agentic-query] Session opened: ${rowId} agent=${session.opencode?.lastUsedConfig?.agent ?? 'build'} workspace=${session.workspaceId}`
    );
  } catch (err) {
    console.warn(
      `[agentic-query] Failed to open session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );
    try {
      await deps.sessionRepository.markFailed(rowId);
    } catch {
      /* best-effort */
    }
  }
}
