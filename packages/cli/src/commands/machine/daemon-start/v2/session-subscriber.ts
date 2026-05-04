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

import { startOpencodeSdkHarness } from '../../../../infrastructure/harnesses/opencode-sdk/index.js';
import { opencodeSdkChunkExtractor } from '../../../../infrastructure/harnesses/opencode-sdk/event-extractor.js';
import type { DaemonContext } from '../types.js';
import { api } from '../../../../api.js';
import type { DirectHarnessSession } from '../../../../domain/direct-harness/entities/direct-harness-session.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type { PromptRepository } from '../../../../domain/direct-harness/ports/prompt-repository.js';
import type { JournalFactory, SessionJournal } from '../../../../domain/direct-harness/usecases/open-session.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ActiveSession {
  readonly harnessSessionRowId: string;
  readonly harnessSessionId: string;
  readonly session: DirectHarnessSession;
  readonly journal: SessionJournal;
  close(): Promise<void>;
}

export interface SessionSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly promptRepository: PromptRepository;
  readonly journalFactory: JournalFactory;
}

export interface SessionSubscriberHandle {
  stop(): void;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startSessionSubscriber(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  deps: SessionSubscriberDeps
): SessionSubscriberHandle {
  const inFlight = new Set<string>();

  const unsub = wsClient.onUpdate(
    api.chatroom.directHarness.sessions.listPendingSessionsForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (pendingSessions: any) => {
      if (!pendingSessions || pendingSessions.length === 0) return;

      for (const session of pendingSessions) {
        const rowId = session._id as string;
        if (inFlight.has(rowId)) continue;
        inFlight.add(rowId);
        void processOne(ctx, deps, session).finally(() => inFlight.delete(rowId));
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processOne(ctx: DaemonContext, deps: SessionSubscriberDeps, session: any): Promise<void> {
  const rowId = session._id as string;

  try {
    // 1. Look up workspace to get workingDir
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workspace: any = await ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: ctx.sessionId,
      workspaceId: session.workspaceId,
    });

    if (!workspace) {
      console.warn(
        `[direct-harness] Cannot open session ${rowId}: workspace ${session.workspaceId} not found`
      );
      await deps.sessionRepository.markClosed(rowId);
      return;
    }

    // 2. Get or create BoundHarness for this workspace
    let harness = deps.harnesses.get(session.workspaceId);
    if (!harness) {
      harness = await startOpencodeSdkHarness({
        type: 'opencode',
        workingDir: workspace.workingDir,
        workspaceId: session.workspaceId,
      });
      deps.harnesses.set(session.workspaceId, harness);
    }

    // 3. Open a session on the harness
    const liveSession = await harness.newSession({
      agent: session.lastUsedConfig.agent,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      harnessSessionRowId: rowId as any,
    });

    // 4. Associate the harness-issued session ID with the existing backend row.
    try {
      await deps.sessionRepository.associateHarnessSessionId(
        rowId,
        liveSession.harnessSessionId as string,
        liveSession.sessionTitle
      );
    } catch (err) {
      await liveSession.close().catch(() => {});
      throw err;
    }

    // 5. Create journal + wire session events → journal
    const journal = deps.journalFactory.create(rowId);
    const unsubscribeEvents = liveSession.onEvent((event) => {
      const content = opencodeSdkChunkExtractor(event);
      if (content !== null) {
        journal.record({ content, timestamp: Date.now() });
      }
    });

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

    // 7. Store in shared registry so prompt-subscriber can find it
    const handle: ActiveSession = {
      harnessSessionRowId: rowId,
      harnessSessionId: liveSession.harnessSessionId as string,
      session: liveSession,
      journal,
      close,
    };
    deps.activeSessions.set(rowId, handle);

    // 8. Claim and process the first pending prompt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const claimed: any = await ctx.deps.backend.mutation(
      api.chatroom.directHarness.prompts.claimNextPendingPrompt,
      { sessionId: ctx.sessionId, machineId: ctx.machineId, harnessSessionRowId: rowId }
    );

    if (claimed && claimed.taskType === 'prompt') {
      try {
        await liveSession.prompt({
          agent: claimed.override.agent,
          parts: claimed.parts,
          ...(claimed.override.model ? { model: claimed.override.model } : {}),
          ...(claimed.override.system ? { system: claimed.override.system } : {}),
          ...(claimed.override.tools ? { tools: claimed.override.tools } : {}),
        });

        await deps.promptRepository.complete(claimed._id, 'done');
      } catch (err) {
        await deps.promptRepository
          .complete(claimed._id, 'error', err instanceof Error ? err.message : String(err))
          .catch(() => {});
        console.warn(
          `[direct-harness] First prompt failed for session ${rowId}:`,
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    console.log(
      `[direct-harness] Session opened: rowId=${rowId} agent=${session.lastUsedConfig.agent} workspace=${session.workspaceId}`
    );
  } catch (err) {
    console.warn(
      `[direct-harness] Failed to open session ${rowId}:`,
      err instanceof Error ? err.message : String(err)
    );

    try {
      await deps.sessionRepository.markClosed(rowId);
    } catch {
      // Best-effort
    }
  }
}
