import { renderWorkspaceAgentSystemPrompt } from '@workspace/backend/prompts/agentic-query/workspace-agent-system-prompt.js';
import type { ConvexClient } from 'convex/browser';

import type { AgenticQuerySubscriptionSession } from './start-subscriptions.js';
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
import { handleSessionIdle } from '../direct-harness/idle-handler.js';
import type { ActiveSession } from '../direct-harness/session-subscriber.js';

interface PendingSessionInfo {
  _id: string;
  workspaceId: string;
  harnessName: string;
  opencodeSessionId: string | undefined;
  agenticQueryId: string;
  chatroomId: string;
  lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
}

interface PendingMessage {
  harnessSessionId: string;
  content: string;
  seq: number;
}

interface SubscriberDeps {
  activeSessions: Map<string, ActiveSession>;
  harnesses: Map<string, BoundHarness>;
  sessionRepository: SessionRepository;
  journalFactory: JournalFactory;
}

interface WorkspaceInfo {
  workingDir: string;
}

async function ensureHarnessAlive(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: SubscriberDeps,
  info: PendingSessionInfo
): Promise<BoundHarness | null> {
  const key = makeHarnessKey(info.workspaceId, info.harnessName);
  const existing = deps.harnesses.get(key);
  if (existing?.isAlive()) return existing;
  if (existing) {
    existing.close().catch(() => {});
    deps.harnesses.delete(key);
  }

  const workspace = (await daemonSession.backend.query(api.workspaces.getWorkspaceById, {
    sessionId: daemonSession.sessionId,
    workspaceId: info.workspaceId,
  })) as WorkspaceInfo | null;
  if (!workspace) {
    console.warn(`[agentic-query] Cannot resume ${info._id}: workspace not found`);
    return null;
  }

  const harness = await startBoundHarness({
    harnessName: info.harnessName as NativeDirectHarnessName,
    workingDir: workspace.workingDir,
    workspaceId: info.workspaceId,
    resolvedConvexUrl: daemonSession.convexUrl,
  });
  deps.harnesses.set(key, harness);
  return harness;
}

function wireResumedIdle(
  handle: ActiveSession,
  deps: SubscriberDeps,
  info: PendingSessionInfo
): void {
  const idleConfig = {
    agent: info.lastUsedConfig.agent ?? 'build',
    model: info.lastUsedConfig.model,
  };
  handle.session.onEvent((event) => {
    if (event.type === 'session.idle') {
      void handleSessionIdle(handle, handle.journal, idleConfig, deps.sessionRepository).catch(
        (err: unknown) => console.warn('[agentic-query] idle handler error (resume):', err)
      );
    }
  });
}

// fallow-ignore-next-line complexity
async function resolveSessionHandle(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: SubscriberDeps,
  info: PendingSessionInfo
): Promise<ActiveSession | null> {
  const rowId = info._id;
  const cached = deps.activeSessions.get(rowId);
  if (cached) return cached;
  if (!info.opencodeSessionId || !info.harnessName) {
    console.log(`[agentic-query] Session ${rowId} not yet open — waiting for session-subscriber`);
    return null;
  }

  try {
    const harness = await ensureHarnessAlive(daemonSession, deps, info);
    if (!harness) return null;
    const resumed = await resumeSession(
      {
        harness,
        journalFactory: deps.journalFactory,
        chunkExtractor: createChunkExtractor(harness.type),
      },
      {
        harnessSessionId: rowId,
        opencodeSessionId: info.opencodeSessionId,
        workspaceId: info.workspaceId,
        harnessName: info.harnessName,
      }
    );
    deps.activeSessions.set(rowId, resumed);
    wireResumedIdle(resumed, deps, info);
    console.log(`[agentic-query] Resumed session ${rowId}`);
    return resumed;
  } catch (err) {
    console.warn(
      `[agentic-query] Resume failed for ${rowId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// fallow-ignore-next-line complexity
async function deliverMessage(
  deps: SubscriberDeps,
  daemonSession: AgenticQuerySubscriptionSession,
  existingSession: ActiveSession,
  info: PendingSessionInfo,
  msg: PendingMessage
): Promise<void> {
  const rowId = info._id;
  await deps.sessionRepository.setGenerating(rowId, true);

  const { turnId } = await deps.sessionRepository.beginAssistantTurn(rowId);
  existingSession.currentTurn = { turnId, messageId: null };

  await existingSession.session.prompt({
    parts: [{ type: 'text', text: msg.content }],
    agent: info.lastUsedConfig.agent,
    ...(info.lastUsedConfig.model ? { model: info.lastUsedConfig.model } : {}),
    system: renderWorkspaceAgentSystemPrompt({
      convexUrl: daemonSession.convexUrl,
      chatroomId: info.chatroomId,
      queryId: info.agenticQueryId,
    }),
  });

  if (existingSession.currentTurn) {
    const { turnId: finalTurnId } = existingSession.currentTurn;
    existingSession.currentTurn = null;
    try {
      await existingSession.journal.flush();
      await deps.sessionRepository.finalizeAssistantTurn(finalTurnId);
    } catch {
      existingSession.currentTurn = { turnId: finalTurnId, messageId: null };
    }
  }

  try {
    await deps.sessionRepository.markTurnProcessed(rowId, msg.seq);
  } catch (err) {
    console.warn(
      `[agentic-query] markTurnProcessed failed for session ${rowId} seq=${msg.seq}: ${err}`
    );
  }
}

async function drainPendingBatch(
  daemonSession: AgenticQuerySubscriptionSession,
  deps: SubscriberDeps,
  batch: { sessions: PendingSessionInfo[]; messages: PendingMessage[] }
): Promise<void> {
  for (const info of batch.sessions) {
    const existingSession = await resolveSessionHandle(daemonSession, deps, info);
    if (!existingSession) continue;

    const pendingMsgs = batch.messages
      .filter((m) => m.harnessSessionId === info._id)
      .sort((a, b) => a.seq - b.seq);

    for (const msg of pendingMsgs) {
      await deliverMessage(deps, daemonSession, existingSession, info, msg);
    }
  }
}

export function startPromptSubscriber(
  daemonSession: AgenticQuerySubscriptionSession,
  wsClient: ConvexClient,
  deps: SubscriberDeps
): { stop: () => void } {
  const handle = wsClient.onUpdate(
    api.daemon.agenticQuery.messages.pendingForMachine,
    { sessionId: daemonSession.sessionId, machineId: daemonSession.machineId },
    async (batch) => {
      if (!batch) return;
      await drainPendingBatch(
        daemonSession,
        deps,
        batch as unknown as { sessions: PendingSessionInfo[]; messages: PendingMessage[] }
      );
    }
  );

  return { stop: handle };
}
