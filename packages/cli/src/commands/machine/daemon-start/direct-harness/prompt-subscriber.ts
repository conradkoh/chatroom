/**
 * Subscribes to unprocessed user messages via Convex WS and dispatches them
 * to the harness session.
 *
 * No prompt lifecycle (submit/claim/complete). The daemon reads user messages
 * directly from the turn stream using cursor-based turn-seq tracking:
 *   1. Query `messages.pendingForMachine` for user turns with
 *      turnSeq > session.lastProcessedTurnSeq
 *   2. For each session with new messages, resolve the handle (lazy resume if
 *      the daemon restarted) and call session.prompt()
 *   3. Mark the turn processed via turns.markTurnProcessed
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
import {
  startOpencodeSdkHarness,
  createOpencodeSdkChunkExtractor,
} from '../../../../infrastructure/harnesses/opencode-sdk/index.js';

// ─── Convex shape types ──────────────────────────────────────────────────────

interface PendingMessage {
  harnessSessionId: string;
  content: string;
  seq: number;
}

/** Shape of a pending session from pendingForMachine. */
interface PendingSessionInfo {
  _id: string;
  workspaceId: string;
  /** Set once the daemon has associated the SDK session. Undefined while still pending. */
  opencodeSessionId: string | undefined;
  lastUsedConfig: { agent: string; model?: { providerID: string; modelID: string } };
}

interface WorkspaceInfo {
  workingDir: string;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface MessageSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly journalFactory: JournalFactory;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

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

// ─── Drain loop ──────────────────────────────────────────────────────────────

async function drain(session: DirectHarnessSession, deps: MessageSubscriberDeps): Promise<void> {
  // Fetch all pending user messages grouped by session
  const pending = (await session.backend.query(
    api.daemon.directHarness.messages.pendingForMachine,
    { sessionId: session.sessionId, machineId: session.machineId }
  )) as {
    sessions: PendingSessionInfo[];
    messages: PendingMessage[];
  } | null;

  if (!pending || pending.messages.length === 0) return;

  // Group messages by session for batch processing
  const bySession = new Map<string, PendingMessage[]>();
  for (const msg of pending.messages) {
    const list = bySession.get(msg.harnessSessionId);
    if (list) {
      list.push(msg);
    } else {
      bySession.set(msg.harnessSessionId, [msg]);
    }
  }

  // Build a session-info lookup
  const sessionInfo = new Map<string, PendingSessionInfo>();
  for (const s of pending.sessions) {
    sessionInfo.set(s._id, s);
  }

  // Process each session's messages
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

// ─── Process messages for a single session ───────────────────────────────────

async function processSessionMessages(
  session: DirectHarnessSession,
  deps: MessageSubscriberDeps,
  rowId: string,
  messages: PendingMessage[],
  info: PendingSessionInfo | undefined
): Promise<void> {
  // 1. Resolve the session handle
  let handle = deps.activeSessions.get(rowId);

  if (!handle) {
    // No in-memory handle. Two sub-cases:
    //   a) Session just opened by session-subscriber but opencodeSessionId not
    //      yet in DB (genuine pending) — info.opencodeSessionId is undefined.
    //      We skip and wait for the subscription to re-fire once the ID is set.
    //   b) Daemon restarted — session is active, opencodeSessionId is in DB.
    //      We lazy-resume.
    const opencodeSessionId = info?.opencodeSessionId;

    if (!opencodeSessionId) {
      // Case (a): session not yet opened — subscription will re-fire when
      // pendingForMachine's opencodeSessionId field changes undefined → string.
      console.warn(
        `[direct-harness] Session ${rowId} not yet open — waiting for session-subscriber`
      );
      return;
    }

    // Case (b): lazy-resume after daemon restart
    const workspaceId = info?.workspaceId;
    if (!workspaceId) {
      console.warn(`[direct-harness] Cannot resume session ${rowId}: no workspace info`);
      return;
    }

    let harness = deps.harnesses.get(workspaceId);
    if (harness && !harness.isAlive()) {
      harness.close().catch(() => {});
      deps.harnesses.delete(workspaceId);
      harness = undefined;
    }
    if (!harness) {
      const workspace = (await session.backend.query(api.workspaces.getWorkspaceById, {
        sessionId: session.sessionId,
        workspaceId,
      })) as WorkspaceInfo | null;

      if (!workspace) {
        console.warn(`[direct-harness] Cannot resume session ${rowId}: workspace not found`);
        return;
      }

      harness = await startOpencodeSdkHarness({
        type: 'opencode',
        workingDir: workspace.workingDir,
        workspaceId,
      });
      deps.harnesses.set(workspaceId, harness);
    }

    try {
      handle = await resumeSession(
        {
          harness,
          journalFactory: deps.journalFactory,
          chunkExtractor: createOpencodeSdkChunkExtractor(),
        },
        { harnessSessionId: rowId, opencodeSessionId, workspaceId }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[direct-harness] Cannot resume session ${rowId}: ${message}`);
      // opencode confirmed the session does not exist on disk.
      await deps.sessionRepository.markFailed(rowId).catch(() => {});
      return;
    }

    deps.activeSessions.set(rowId, handle);
    // Session reconnected — update status so the UI reflects it.
    await deps.sessionRepository.markActive(rowId).catch(() => {});

    // Wire session.idle so queued messages are drained after a daemon restart.
    // Wire first-chunk → bindTurnMessageId for the resumed session.
    const idleConfig = {
      agent: info?.lastUsedConfig.agent ?? 'build',
      model: info?.lastUsedConfig.model,
    };
    // Track which (turnId, messageId) pair we've already dispatched a bind for
    let lastBoundKey: string | null = null;
    handle.session.onEvent((event) => {
      // First-chunk bind: resumeSession sets currentTurn.messageId on chunk events.
      // We watch for when it becomes non-null and call bind (idempotent on backend).
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const turn = handle!.currentTurn;
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
      if (event.type === 'session.idle') {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        void handleSessionIdle(handle!, handle!.journal, idleConfig, deps.sessionRepository).catch(
          (err: unknown) => console.warn('[direct-harness] idle handler error (resume):', err)
        );
      }
    });
  }

  // 2. Send each pending user message as a prompt
  for (const msg of messages) {
    const override = info?.lastUsedConfig ?? { agent: 'build' };

    try {
      await deps.sessionRepository.setGenerating(rowId, true);

      // Begin assistant turn eagerly before sending the prompt
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
      // The prompt failed — likely the harness process crashed. The opencode
      // session is still on disk, so mark idle (resumable) rather than closed.
      await deps.sessionRepository.markIdle(rowId).catch(() => {});
      deps.activeSessions.delete(rowId);
      if (info?.workspaceId) deps.harnesses.delete(info.workspaceId);
      return;
    }
  }
}
