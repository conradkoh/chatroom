/**
 * Reactive subscription for pending task execution in the direct-harness daemon.
 *
 * Subscribes to `getPendingPromptsForMachine` via the Convex WebSocket client.
 * When new pending tasks appear, the daemon claims and executes them.
 *
 * Handles two task types:
 * - 'prompt': sends a text prompt to the harness session
 * - 'resume': reconnects to an existing harness session
 *
 * Lazy resume contract: sessions are NOT auto-resumed on daemon startup.
 * Resume only happens on explicit user action (click in the UI). This keeps
 * daemon boot fast and avoids surprise costs.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import type { ConvexClient } from 'convex/browser';

import type { DaemonContext } from './types.js';
import { SessionHandleRegistry } from './session-handle-registry.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import {
  createDefaultFlushStrategy,
  wireEventSink,
} from '../../../application/direct-harness/internal.js';
import { promptSession } from '../../../application/direct-harness/prompt-session.js';
import type { HarnessSessionId, HarnessSessionRowId } from '../../../domain/index.js';
import { openCodeChunkExtractor } from '../../../infrastructure/harnesses/opencode-sdk/chunk-extractor.js';
import {
  BufferedMessageStreamSink,
  ConvexMessageStreamTransport,
} from '../../../infrastructure/services/direct-harness/message-stream/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startPendingPromptSubscription` to stop the subscription. */
export interface PendingPromptSubscriptionHandle {
  stop: () => void;
}

/**
 * Start the reactive pending-task subscription.
 *
 * Only active when the `directHarnessWorkers` feature flag is enabled.
 * When pending tasks appear for this machine, claims and executes them
 * sequentially.
 */
export function startPendingPromptSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  harnessRegistry: HarnessProcessRegistry,
  sessionRegistry: SessionHandleRegistry
): PendingPromptSubscriptionHandle {
  if (!featureFlags.directHarnessWorkers) {
    return { stop: () => {} };
  }

  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.chatroom.directHarness.prompts.getPendingPromptsForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (_pendingPrompts) => {
      // Subscription fires on any change — claim + execute via mutation
      if (processing) return;

      processing = true;
      void drainPendingTasks(ctx, harnessRegistry, sessionRegistry)
        .catch((err: unknown) => {
          console.warn(`[direct-harness] Pending task processing failed: ${getErrorMessage(err)}`);
        })
        .finally(() => {
          processing = false;
        });
    },
    (err: unknown) => {
      console.warn(`[direct-harness] Pending task subscription error: ${getErrorMessage(err)}`);
    }
  );

  return {
    stop: () => {
      unsubscribe();
    },
  };
}

/**
 * Claim and execute all pending tasks for this machine, one at a time.
 * Stops when no more pending tasks remain.
 */
async function drainPendingTasks(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  sessionRegistry: SessionHandleRegistry
): Promise<void> {
  while (true) {
    // Atomically claim the next pending task
    const claimed = await ctx.deps.backend.mutation(
      api.chatroom.directHarness.prompts.claimNextPendingPrompt,
      { sessionId: ctx.sessionId, machineId: ctx.machineId }
    );

    if (!claimed) break; // No more pending tasks

    await executeClaimedTask(ctx, harnessRegistry, sessionRegistry, claimed);
  }
}

/**
 * Execute one claimed task — dispatches to prompt or resume handler based on taskType.
 */
async function executeClaimedTask(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  sessionRegistry: SessionHandleRegistry,
  claimed: {
    _id: Id<'chatroom_pendingPrompts'>;
    harnessSessionRowId: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
    taskType: 'prompt' | 'resume';
    parts: { type: 'text'; text: string }[];
    override: {
      agent: string;
      model?: { providerID: string; modelID: string };
      system?: string;
      tools?: Record<string, boolean>;
    };
  }
): Promise<void> {
  // Look up the workspace to get cwd (for getOrSpawn)
  const workspace = await ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
    sessionId: ctx.sessionId,
    workspaceId: claimed.workspaceId,
  });

  if (!workspace) {
    await ctx.deps.backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      promptId: claimed._id,
      status: 'error',
      errorMessage: `Workspace ${claimed.workspaceId} not found`,
    });
    return;
  }

  // Get or spawn the harness process for this workspace
  // (Resume also needs the harness process — it may not be running after a daemon restart)
  const harnessProcess = await harnessRegistry
    .getOrSpawn(claimed.workspaceId as string, workspace.workingDir)
    .catch((err: unknown) => {
      throw new Error(
        `Failed to get harness for workspace ${claimed.workspaceId}: ${getErrorMessage(err)}`
      );
    });

  if (claimed.taskType === 'resume') {
    await executeResumeTask(ctx, harnessProcess, sessionRegistry, claimed);
  } else {
    await executePromptTask(ctx, harnessProcess, sessionRegistry, claimed);
  }
}

/**
 * Execute a 'resume' task — reconnect to an existing harness session.
 *
 * Creates a new session + sink, wires them, and registers in the shared
 * registry so subsequent prompts reuse this session.
 */
async function executeResumeTask(
  ctx: DaemonContext,
  harnessProcess: Awaited<ReturnType<HarnessProcessRegistry['getOrSpawn']>>,
  sessionRegistry: SessionHandleRegistry,
  claimed: {
    _id: Id<'chatroom_pendingPrompts'>;
    harnessSessionRowId: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
  }
): Promise<void> {
  const rowId = claimed.harnessSessionRowId as string;

  // Get the session's harnessSessionId to resume with
  const backendSession = await ctx.deps.backend.query(api.chatroom.directHarness.sessions.getSession, {
    sessionId: ctx.sessionId,
    harnessSessionRowId: claimed.harnessSessionRowId,
  });

  if (!backendSession?.harnessSessionId) {
    await ctx.deps.backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      promptId: claimed._id,
      status: 'error',
      errorMessage:
        'Session has no harness session ID — it may not have completed spawning originally',
    });
    return;
  }

  try {
    // Reconnect to the harness session by its SDK-issued ID
    const liveSession = await harnessProcess.spawner.resumeSession(
      backendSession.harnessSessionId as HarnessSessionId
    );

    // Create transport + sink and wire them to the resumed session
    const transport = new ConvexMessageStreamTransport({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });
    const sink = new BufferedMessageStreamSink({
      workerId: claimed.harnessSessionRowId as unknown as HarnessSessionRowId,
      transport,
      strategy: createDefaultFlushStrategy(),
    });
    wireEventSink(liveSession, sink, openCodeChunkExtractor);

    // Register in shared registry so subsequent prompts reuse this session
    sessionRegistry.register(rowId, { session: liveSession, sink, rowId });

    // Mark session as active again, syncing the title from the resumed session
    await ctx.deps.backend.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId: ctx.sessionId,
      harnessSessionRowId: claimed.harnessSessionRowId,
      harnessSessionId: backendSession.harnessSessionId,
      sessionTitle: liveSession.sessionTitle,
    });

    await ctx.deps.backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      promptId: claimed._id,
      status: 'done',
    });
  } catch (err) {
    await ctx.deps.backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      promptId: claimed._id,
      status: 'error',
      errorMessage: err instanceof Error ? err.message : String(err),
    });
    // Also mark the session itself as failed
    await ctx.deps.backend
      .mutation(api.chatroom.directHarness.sessions.closeSession, {
        sessionId: ctx.sessionId,
        harnessSessionRowId: claimed.harnessSessionRowId,
      })
      .catch(() => {}); // best-effort
    throw err;
  }
}

/**
 * Execute a 'prompt' task — send a text prompt to the harness session.
 *
 * Uses the existing session + sink from the shared registry (created by
 * processSession or a prior resume). Falls back to creating a new session
 * + sink if none is registered (e.g. after daemon restart).
 *
 * The session is kept alive across prompts — no per-prompt close/abort.
 */
async function executePromptTask(
  ctx: DaemonContext,
  harnessProcess: Awaited<ReturnType<HarnessProcessRegistry['getOrSpawn']>>,
  sessionRegistry: SessionHandleRegistry,
  claimed: {
    _id: Id<'chatroom_pendingPrompts'>;
    harnessSessionRowId: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
    parts: { type: 'text'; text: string }[];
    override: {
      agent: string;
      model?: { providerID: string; modelID: string };
      system?: string;
      tools?: Record<string, boolean>;
    };
  }
): Promise<void> {
  const rowId = claimed.harnessSessionRowId as string;

  // Resolve the active session handle (from registry or by resuming)
  let handle = sessionRegistry.get(rowId);

  if (!handle) {
    // No active handle — session was opened by processSession on a prior
    // daemon run, or the process died. Resume the session and create a
    // fresh sink. Register it so future prompts reuse it.
    const backendSession = await ctx.deps.backend.query(api.chatroom.directHarness.sessions.getSession, {
      sessionId: ctx.sessionId,
      harnessSessionRowId: claimed.harnessSessionRowId,
    });

    if (!backendSession?.harnessSessionId) {
      await ctx.deps.backend.mutation(api.chatroom.directHarness.prompts.completePendingPrompt, {
        sessionId: ctx.sessionId,
        machineId: ctx.machineId,
        promptId: claimed._id,
        status: 'error',
        errorMessage: 'Session has no harness session ID — it may not have been spawned yet',
      });
      return;
    }

    const liveSession = await harnessProcess.spawner.resumeSession(
      backendSession.harnessSessionId as HarnessSessionId
    );
    const transport = new ConvexMessageStreamTransport({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });
    const sink = new BufferedMessageStreamSink({
      workerId: claimed.harnessSessionRowId as unknown as HarnessSessionRowId,
      transport,
      strategy: createDefaultFlushStrategy(),
    });
    wireEventSink(liveSession, sink, openCodeChunkExtractor);

    handle = { session: liveSession, sink, rowId };
    sessionRegistry.register(rowId, handle);
  }

  // Send the prompt through the existing session — response streams
  // through the already-wired sink.
  await promptSession(
    {
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      prompt: async (_harnessSessionId, input) => {
        await handle!.session.prompt(input);
      },
    },
    {
      harnessSessionRowId: rowId,
      promptId: claimed._id as string,
      parts: claimed.parts,
      override: claimed.override,
    }
  );
}
