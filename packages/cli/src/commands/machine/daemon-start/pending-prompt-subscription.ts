/**
 * Reactive subscription for pending prompt execution in the direct-harness daemon.
 *
 * Subscribes to `getPendingPromptsForMachine` via the Convex WebSocket client.
 * When new pending prompts appear, the daemon claims and executes them.
 */

import type { ConvexClient } from 'convex/browser';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import { promptSession } from '../../../application/direct-harness/prompt-session.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import type { DaemonContext } from './types.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startPendingPromptSubscription` to stop the subscription. */
export interface PendingPromptSubscriptionHandle {
  stop: () => void;
}

/**
 * Start the reactive pending-prompt subscription.
 *
 * Only active when the `directHarnessWorkers` feature flag is enabled.
 * When pending prompts appear for this machine, claims and executes them
 * sequentially using `promptSession`.
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
      void drainPendingPrompts(ctx, harnessRegistry)
        .catch((err: unknown) => {
          console.warn(
            `[direct-harness] Pending prompt processing failed: ${getErrorMessage(err)}`
          );
        })
        .finally(() => {
          processing = false;
        });
    },
    (err: unknown) => {
      console.warn(
        `[direct-harness] Pending prompt subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  return {
    stop: () => {
      unsubscribe();
    },
  };
}

/**
 * Claim and execute all pending prompts for this machine, one at a time.
 * Stops when no more pending prompts remain.
 */
async function drainPendingPrompts(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry
): Promise<void> {
  while (true) {
    // Atomically claim the next pending prompt
    const claimed = await ctx.deps.backend.mutation(
      api.chatroom.directHarness.prompts.claimNextPendingPrompt,
      { sessionId: ctx.sessionId, machineId: ctx.machineId }
    );

    if (!claimed) break; // No more pending prompts

    await executeClaimedPrompt(ctx, harnessRegistry, claimed);
  }
}

/**
 * Execute one claimed prompt — find the harness session, call prompt(), complete the row.
 */
async function executeClaimedPrompt(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  claimed: {
    _id: Id<'chatroom_pendingPrompts'>;
    harnessSessionRowId: Id<'chatroom_harnessSessions'>;
    workspaceId: Id<'chatroom_workspaces'>;
    parts: Array<{ type: 'text'; text: string }>;
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
  const harnessProcess = await harnessRegistry
    .getOrSpawn(claimed.workspaceId as string, workspace.workingDir)
    .catch((err: unknown) => {
      throw new Error(`Failed to get harness for workspace ${claimed.workspaceId}: ${getErrorMessage(err)}`);
    });

  await promptSession(
    {
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
      prompt: async (harnessSessionId, input) => {
        const session = harnessProcess.spawner;
        const liveSession = await session.resumeSession(harnessSessionId);
        await liveSession.prompt(input);
      },
    },
    {
      harnessSessionRowId: claimed.harnessSessionRowId as string,
      promptId: claimed._id as string,
      parts: claimed.parts,
    }
  );
}
