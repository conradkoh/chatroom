/**
 * Subscribes to pending prompts via Convex WS and dispatches to
 * domain promptSession or resumeSession.
 *
 * Two task types:
 *   - 'prompt': sends a text prompt to an existing harness session
 *   - 'resume': reconnects to an existing harness session
 *
 * Lazy resume contract: sessions are NOT auto-resumed on daemon
 * startup. Resume only happens when a prompt arrives for a session
 * that isn't already active (e.g. after daemon restart).
 */

import type { ConvexClient } from 'convex/browser';

import { startOpencodeSdkHarness } from '../../../../infrastructure/harnesses/opencode-sdk/index.js';
import { opencodeSdkChunkExtractor } from '../../../../infrastructure/harnesses/opencode-sdk/event-extractor.js';
import type { ActiveSession } from './session-subscriber.js';
import type { DaemonContext } from '../types.js';
import { api } from '../../../../api.js';
import { promptSession } from '../../../../domain/direct-harness/usecases/prompt-session.js';
import { resumeSession } from '../../../../domain/direct-harness/usecases/resume-session.js';
import type { BoundHarness } from '../../../../domain/direct-harness/entities/bound-harness.js';
import type { SessionRepository } from '../../../../domain/direct-harness/ports/session-repository.js';
import type { PromptRepository } from '../../../../domain/direct-harness/ports/prompt-repository.js';
import type { JournalFactory } from '../../../../domain/direct-harness/usecases/open-session.js';

// ─── Convex shape types ──────────────────────────────────────────────────────

interface KnownPendingPrompt {
  _id: string;
  harnessSessionRowId: string;
  workspaceId: string;
  taskType: 'prompt' | 'resume';
  parts: { type: 'text'; text: string }[];
  override: {
    agent: string;
    model?: { providerID: string; modelID: string };
    system?: string;
    tools?: Record<string, boolean>;
  };
}

interface WorkspaceInfo {
  workingDir: string;
}

// ─── Deps ────────────────────────────────────────────────────────────────────

export interface PromptSubscriberDeps {
  readonly activeSessions: Map<string, ActiveSession>;
  readonly harnesses: Map<string, BoundHarness>;
  readonly sessionRepository: SessionRepository;
  readonly promptRepository: PromptRepository;
  readonly journalFactory: JournalFactory;
}

// ─── Subscriber ──────────────────────────────────────────────────────────────

export function startPromptSubscriber(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  deps: PromptSubscriberDeps
): { stop: () => void } {
  let processing = false;

  const unsub = wsClient.onUpdate(
    api.chatroom.directHarness.prompts.getPendingPromptsForMachine,
    { sessionId: ctx.sessionId, machineId: ctx.machineId },
    () => {
      if (processing) return;
      processing = true;
      void drain(ctx, deps).finally(() => {
        processing = false;
      });
    },
    (err: unknown) => {
      console.warn(
        '[direct-harness] Prompt subscription error:',
        err instanceof Error ? err.message : String(err)
      );
    }
  );

  return { stop: unsub };
}

// ─── Drain loop ──────────────────────────────────────────────────────────────

async function drain(ctx: DaemonContext, deps: PromptSubscriberDeps): Promise<void> {
  while (true) {
    const claimed = (await ctx.deps.backend.mutation(
      api.chatroom.directHarness.prompts.claimNextPendingPrompt,
      { sessionId: ctx.sessionId, machineId: ctx.machineId }
    )) as KnownPendingPrompt | null;

    if (!claimed) break;

    try {
      await executeOne(ctx, deps, claimed);
    } catch (err) {
      console.warn(
        `[direct-harness] Prompt ${claimed._id} failed:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

// ─── Single prompt execution ─────────────────────────────────────────────────

async function executeOne(
  ctx: DaemonContext,
  deps: PromptSubscriberDeps,
  prompt: KnownPendingPrompt
): Promise<void> {
  // 1. Look up workspace to get workingDir
  const workspace = (await ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
    sessionId: ctx.sessionId,
    workspaceId: prompt.workspaceId,
  })) as WorkspaceInfo | null;

  if (!workspace) {
    await deps.promptRepository.complete(
      prompt._id,
      'error',
      `Workspace ${prompt.workspaceId} not found`
    );
    return;
  }

  // 2. Get or create BoundHarness for this workspace
  let harness = deps.harnesses.get(prompt.workspaceId);
  if (!harness) {
    harness = await startOpencodeSdkHarness({
      type: 'opencode',
      workingDir: workspace.workingDir,
      workspaceId: prompt.workspaceId,
    });
    deps.harnesses.set(prompt.workspaceId, harness);
  }

  if (prompt.taskType === 'prompt') {
    await executePromptTask(ctx, deps, harness, prompt);
  } else {
    await executeResumeTask(ctx, deps, harness, prompt);
  }
}

// ─── Prompt task ─────────────────────────────────────────────────────────────

async function executePromptTask(
  ctx: DaemonContext,
  deps: PromptSubscriberDeps,
  harness: BoundHarness,
  prompt: KnownPendingPrompt
): Promise<void> {
  const rowId = prompt.harnessSessionRowId;

  // Resolve the active session handle
  let handle = deps.activeSessions.get(rowId);

  if (!handle) {
    // Daemon may have restarted — resume the session
    const harnessSessionId = await deps.sessionRepository.getHarnessSessionId(rowId);

    if (!harnessSessionId) {
      await deps.promptRepository.complete(
        prompt._id,
        'error',
        `Session ${rowId} has no harness session ID — it may not have completed spawning`
      );
      return;
    }

    handle = await resumeSession(
      {
        harness,
        journalFactory: deps.journalFactory,
        chunkExtractor: opencodeSdkChunkExtractor,
      },
      { harnessSessionRowId: rowId, harnessSessionId }
    );

    deps.activeSessions.set(rowId, handle);
  }

  // Domain promptSession handles completion (done/error) internally
  await promptSession(
    {
      sessionRepository: deps.sessionRepository,
      promptRepository: deps.promptRepository,
      session: handle.session,
    },
    {
      harnessSessionRowId: rowId,
      promptId: prompt._id,
      parts: prompt.parts,
      override: prompt.override,
    }
  );
}

// ─── Resume task ─────────────────────────────────────────────────────────────

async function executeResumeTask(
  ctx: DaemonContext,
  deps: PromptSubscriberDeps,
  harness: BoundHarness,
  prompt: KnownPendingPrompt
): Promise<void> {
  const rowId = prompt.harnessSessionRowId;

  // Get the harness session ID from the backend row
  const harnessSessionId = await deps.sessionRepository.getHarnessSessionId(rowId);

  if (!harnessSessionId) {
    await deps.promptRepository.complete(
      prompt._id,
      'error',
      `Session ${rowId} has no harness session ID — it may not have completed spawning`
    );
    return;
  }

  try {
    const handle = await resumeSession(
      {
        harness,
        journalFactory: deps.journalFactory,
        chunkExtractor: opencodeSdkChunkExtractor,
      },
      { harnessSessionRowId: rowId, harnessSessionId }
    );

    deps.activeSessions.set(rowId, handle);
    await deps.promptRepository.complete(prompt._id, 'done');

    console.log(`[direct-harness] Session resumed: rowId=${rowId}`);
  } catch (err) {
    // Mark the session as failed so the UI shows an error
    await deps.promptRepository.complete(
      prompt._id,
      'error',
      err instanceof Error ? err.message : String(err)
    );
    await deps.sessionRepository.markClosed(rowId).catch(() => {});
    throw err;
  }
}
