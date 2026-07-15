/**
 * Subscribes to unprocessed user messages via Convex WS and dispatches them
 * to the harness session.
 */

import type { ConvexClient } from 'convex/browser';

import type { DirectHarnessSession } from './command-subscriber.js';
import { handleSessionIdle } from './idle-handler.js';
import type { ActiveSession } from './session-subscriber.js';
import { api } from '../../../../api.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type { JournalFactory } from '../../../../domain/direct-harness/usecases/open-session.js';
import { resumeSession } from '../../../../domain/direct-harness/usecases/resume-session.js';
import { makeHarnessKey } from '../../../../infrastructure/harnesses/harness-key.js';
import {
  createChunkExtractor,
  startBoundHarness,
  type NativeDirectHarnessName,
} from '../../../../infrastructure/harnesses/registry.js';
import { OPENCODE_SESSION_EVENT_TYPES } from '../../../../infrastructure/services/remote-agents/opencode-sdk/opencode-session-events.js';

interface PendingMessage {
  harnessSessionId: string;
  content: string;
  seq: number;
}

interface PendingSessionInfo {
  _id: string;
  workspaceId: string;
  harnessName: string;
  opencodeSessionId: string | undefined;
  lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
}

interface WorkspaceInfo {
  workingDir: string;
}

export interface MessageSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly journalFactory: JournalFactory;
}

export function startMessageSubscriber(
  session: DirectHarnessSession,
  wsClient: ConvexClient,
  deps: MessageSubscriberDeps
): { stop: () => void } {
  let processing = false;

  const unsub = wsClient.onUpdate(
    api.daemon.directHarness.messages.pendingForMachine,
    { sessionId: session.sessionId, machineId: session.machineId },
    () => {
      if (processing) return;
      processing = true;
      void drain(session, deps).finally(() => {
        processing = false;
      });
    },
    (err: unknown) => {
      console.warn(
        '[direct-harness] Message subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

async function drain(session: DirectHarnessSession, deps: MessageSubscriberDeps): Promise<void> {
  const pending = (await session.backend.query(
    api.daemon.directHarness.messages.pendingForMachine,
    { sessionId: session.sessionId, machineId: session.machineId }
  )) as {
    sessions: PendingSessionInfo[];
    messages: PendingMessage[];
  } | null;

  if (!pending || pending.messages.length === 0) return;

  const bySession = new Map<string, PendingMessage[]>();
  for (const msg of pending.messages) {
    const list = bySession.get(msg.harnessSessionId);
    if (list) {
      list.push(msg);
    } else {
      bySession.set(msg.harnessSessionId, [msg]);
    }
  }

  const sessionInfo = new Map<string, PendingSessionInfo>();
  for (const s of pending.sessions) {
    sessionInfo.set(s._id, s);
  }

  for (const [rowId, messages] of bySession) {
    try {
      await processSessionMessages(session, deps, rowId, messages, sessionInfo.get(rowId));
    } catch (err) {
      console.warn(
        `[direct-harness] Failed to process messages for session ${rowId}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

async function resumeSessionHandle(
  session: DirectHarnessSession,
  deps: MessageSubscriberDeps,
  rowId: string,
  info: PendingSessionInfo
): Promise<ActiveSession | null> {
  const opencodeSessionId = info.opencodeSessionId;
  if (!opencodeSessionId) {
    console.warn(`[direct-harness] Session ${rowId} not yet open — waiting for session-subscriber`);
    return null;
  }

  const workspaceId = info.workspaceId;
  const harnessName = info.harnessName;
  if (!workspaceId) {
    console.warn(`[direct-harness] Cannot resume session ${rowId}: no workspace info`);
    return null;
  }

  const key = makeHarnessKey(workspaceId, harnessName);
  let harness = deps.harnesses.get(key);
  if (harness && !harness.isAlive()) {
    harness.close().catch(() => {});
    deps.harnesses.delete(key);
    harness = undefined;
  }
  if (!harness) {
    const workspace = (await session.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: session.sessionId,
      workspaceId,
    })) as WorkspaceInfo | null;

    if (!workspace) {
      console.warn(`[direct-harness] Cannot resume session ${rowId}: workspace not found`);
      return null;
    }

    harness = await startBoundHarness({
      harnessName: harnessName as NativeDirectHarnessName,
      workingDir: workspace.workingDir,
      workspaceId,
      resolvedConvexUrl: session.convexUrl,
    });
    deps.harnesses.set(key, harness);
  }

  try {
    return await resumeSession(
      {
        harness,
        journalFactory: deps.journalFactory,
        chunkExtractor: createChunkExtractor(harness.type),
      },
      { harnessSessionId: rowId, opencodeSessionId, workspaceId, harnessName }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[direct-harness] Cannot resume session ${rowId}: ${message}`);
    await deps.sessionRepository.markFailed(rowId).catch(() => {});
    return null;
  }
}

function wireResumedSessionEvents(
  handle: ActiveSession,
  deps: MessageSubscriberDeps,
  info: PendingSessionInfo
): void {
  const idleConfig = {
    agent: info.lastUsedConfig.agent ?? 'build',
    model: info.lastUsedConfig.model,
  };
  let lastBoundKey: string | null = null;
  handle.session.onEvent((event) => {
    const turn = handle.currentTurn;
    if (turn?.messageId !== null && turn?.messageId !== undefined) {
      const key = `${turn.turnId}:${turn.messageId}`;
      if (key !== lastBoundKey) {
        lastBoundKey = key;
        deps.sessionRepository
          .bindTurnMessageId(turn.turnId, turn.messageId)
          .catch((err: unknown) =>
            console.warn('[direct-harness] bindTurnMessageId error (resume):', err)
          );
      }
    }
    if (event.type === OPENCODE_SESSION_EVENT_TYPES[0]) {
      // session.idle
      void handleSessionIdle(handle, handle.journal, idleConfig, deps.sessionRepository).catch(
        (err: unknown) => console.warn('[direct-harness] idle handler error (resume):', err)
      );
    }
  });
}

// fallow-ignore-next-line complexity
async function deliverPendingMessages(
  handle: ActiveSession,
  deps: MessageSubscriberDeps,
  rowId: string,
  messages: PendingMessage[],
  info: PendingSessionInfo | undefined,
  daemonSession: DirectHarnessSession
): Promise<void> {
  for (const msg of messages) {
    const override = info?.lastUsedConfig ?? { agent: 'build' };

    try {
      await deps.sessionRepository.setGenerating(rowId, true);

      const { turnId } = await deps.sessionRepository.beginAssistantTurn(rowId);
      handle.currentTurn = { turnId, messageId: null };

      await handle.session.prompt({
        parts: [{ type: 'text', text: msg.content }],
        agent: override.agent,
        ...(override.model ? { model: override.model } : {}),
      });

      await deps.sessionRepository.markTurnProcessed(rowId, msg.seq);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `[direct-harness] Prompt failed for session ${rowId} seq=${msg.seq}: ${message}`
      );
      await deps.sessionRepository.markIdle(rowId).catch(() => {});
      deps.activeSessions.delete(rowId);
      if (info?.workspaceId && info.harnessName) {
        deps.harnesses.delete(makeHarnessKey(info.workspaceId, info.harnessName));
      }
      return;
    }
  }
}

async function processSessionMessages(
  session: DirectHarnessSession,
  deps: MessageSubscriberDeps,
  rowId: string,
  messages: PendingMessage[],
  info: PendingSessionInfo | undefined
): Promise<void> {
  let handle = deps.activeSessions.get(rowId);

  if (!handle) {
    if (!info) {
      console.warn(
        `[direct-harness] Session ${rowId} not yet open — waiting for session-subscriber`
      );
      return;
    }
    const resumed = await resumeSessionHandle(session, deps, rowId, info);
    if (!resumed) {
      return;
    }
    handle = resumed;
    deps.activeSessions.set(rowId, handle);
    await deps.sessionRepository.markActive(rowId).catch(() => {});
    wireResumedSessionEvents(handle, deps, info);
  }

  await deliverPendingMessages(handle, deps, rowId, messages, info, session);
}
