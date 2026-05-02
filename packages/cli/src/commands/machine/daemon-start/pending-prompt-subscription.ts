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
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import { promptSession } from '../../../application/direct-harness/prompt-session.js';
import type { HarnessSessionId } from '../../../domain/direct-harness/index.js';
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
  harnessRegistry: HarnessProcessRegistry
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
      void drainPendingTasks(ctx, harnessRegistry)
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
  harnessRegistry: HarnessProcessRegistry
): Promise<void> {
  while (true) {
    // Atomically claim the next pending task
    const claimed = await ctx.deps.backend.mutation(
      api.chatroom.directHarness.prompts.claimNextPendingPrompt,
      { sessionId: ctx.sessionId, machineId: ctx.machineId }
    );

    if (!claimed) break; // No more pending tasks

    await executeClaimedTask(ctx, harnessRegistry, claimed);
  }
}

/**
 * Execute one claimed task — dispatches to prompt or resume handler based on taskType.
 */
async function executeClaimedTask(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
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
    await executeResumeTask(ctx, harnessProcess.spawner, claimed);
  } else {
    await executePromptTask(ctx, harnessProcess, claimed);
  }
}

/**
 * Execute a 'resume' task — reconnect to an existing harness session.
 */
async function executeResumeTask(
  ctx: DaemonContext,
  spawner: HarnessProcessRegistry extends { getOrSpawn: (...args: any[]) => Promise<infer P> }
    ? P extends { spawner: infer S }
      ? S
      : never
    : never,
  claimed: {
    _id: Id<'chatroom_pendingPrompts'>;
    harnessSessionRowId: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
  }
): Promise<void> {
  // Get the session's harnessSessionId to resume with
  const session = await ctx.deps.backend.query(api.chatroom.directHarness.sessions.getSession, {
    sessionId: ctx.sessionId,
    harnessSessionRowId: claimed.harnessSessionRowId,
  });

  if (!session?.harnessSessionId) {
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
    await spawner.resumeSession(session.harnessSessionId as HarnessSessionId);

    // Mark session as active again
    await ctx.deps.backend.mutation(api.chatroom.directHarness.sessions.associateHarnessSessionId, {
      sessionId: ctx.sessionId,
      harnessSessionRowId: claimed.harnessSessionRowId,
      harnessSessionId: session.harnessSessionId,
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
 */
async function executePromptTask(
  ctx: DaemonContext,
  harnessProcess: Awaited<ReturnType<HarnessProcessRegistry['getOrSpawn']>>,
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
  await promptSession(
    {
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      prompt: async (harnessSessionId, input) => {
        const liveSession = await harnessProcess.spawner.resumeSession(harnessSessionId);
        await liveSession.prompt(input);
      },
    },
    {
      harnessSessionRowId: claimed.harnessSessionRowId as string,
      promptId: claimed._id as string,
      parts: claimed.parts,
      override: claimed.override,
    }
  );
}
