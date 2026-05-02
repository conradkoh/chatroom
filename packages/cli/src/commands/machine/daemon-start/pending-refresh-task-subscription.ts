/**
 * Reactive subscription for pending capability refresh tasks in the direct-harness daemon.
 *
 * Subscribes to `getPendingRefreshTasksForMachine` via the Convex WebSocket client.
 * When pending refresh tasks appear, the daemon re-discovers harness capabilities
 * and republishes via the existing publishMachineSnapshot path.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import type { ConvexClient } from 'convex/browser';

import { MachineCapabilitiesCache, publishMachineSnapshot } from './capabilities-sync.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';
import { ConvexCapabilitiesPublisher } from '../../../infrastructure/direct-harness/convex-capabilities-publisher.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

/** Handle returned by `startPendingRefreshTaskSubscription` to stop the subscription. */
export interface PendingRefreshTaskSubscriptionHandle {
  stop: () => void;
}

/**
 * Start the reactive pending-refresh-task subscription.
 *
 * Only active when the `directHarnessWorkers` feature flag is enabled.
 * When refresh tasks appear for this machine's workspaces, re-discovers
 * capabilities and republishes the machine snapshot.
 */
export function startPendingRefreshTaskSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient,
  harnessRegistry: HarnessProcessRegistry
): PendingRefreshTaskSubscriptionHandle {
  if (!featureFlags.directHarnessWorkers) {
    return { stop: () => {} };
  }

  let processing = false;

  const unsubscribe = wsClient.onUpdate(
    api.chatroom.directHarness.capabilities.getPendingRefreshTasksForMachine,
    {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    },
    (pendingTasks) => {
      if (!pendingTasks || pendingTasks.length === 0) return;
      if (processing) return;

      processing = true;
      void drainRefreshTasks(ctx, harnessRegistry, pendingTasks)
        .catch((err: unknown) => {
          console.warn(
            `[${formatTimestamp()}] [direct-harness] Refresh task processing failed: ${getErrorMessage(err)}`
          );
        })
        .finally(() => {
          processing = false;
        });
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] [direct-harness] Refresh task subscription error: ${getErrorMessage(err)}`
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
 * Process all pending refresh tasks.
 */
async function drainRefreshTasks(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  pendingTasks: Array<{
    _id: Id<'chatroom_pendingDaemonTasks'>;
    workspaceId: Id<'chatroom_workspaces'>;
    taskType: string;
  }>
): Promise<void> {
  for (const task of pendingTasks) {
    await executeRefreshTask(ctx, harnessRegistry, task);
  }
}

/**
 * Execute a single refresh task by re-discovering harness capabilities
 * for the task's workspace and republishing the machine snapshot.
 */
async function executeRefreshTask(
  ctx: DaemonContext,
  harnessRegistry: HarnessProcessRegistry,
  task: {
    _id: Id<'chatroom_pendingDaemonTasks'>;
    workspaceId: Id<'chatroom_workspaces'>;
    taskType: string;
  }
): Promise<void> {
  console.log(
    `[${formatTimestamp()}] 🔄 Processing refresh task ${task._id} for workspace ${task.workspaceId}`
  );

  try {
    // Get the workspace metadata
    const workspace = await ctx.deps.backend.query(api.workspaces.getWorkspaceById, {
      sessionId: ctx.sessionId,
      workspaceId: task.workspaceId,
    });

    if (!workspace) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Workspace ${task.workspaceId} not found — marking task failed`
      );
      await ctx.deps.backend.mutation(api.chatroom.directHarness.capabilities.completeRefreshTask, {
        sessionId: ctx.sessionId,
        taskId: task._id,
        status: 'failed',
        errorMessage: `Workspace ${task.workspaceId} not found`,
      });
      return;
    }

    // Get or spawn the harness process for this workspace
    const harnessProcess = await harnessRegistry
      .getOrSpawn(task.workspaceId as string, workspace.workingDir)
      .catch((err: unknown) => {
        throw new Error(
          `Failed to get harness for workspace ${task.workspaceId}: ${getErrorMessage(err)}`
        );
      });

    // Re-discover agents and providers
    const agents = await harnessProcess.listAgents();
    let providers: Awaited<ReturnType<typeof harnessProcess.listProviders>> = [];
    try {
      providers = await harnessProcess.listProviders();
    } catch (providerErr) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  listProviders failed during refresh for workspace ${task.workspaceId}: ${
          providerErr instanceof Error ? providerErr.message : String(providerErr)
        }. Publishing with empty providers.`
      );
    }

    // Build a temporary cache for publishing
    const capabilitiesCache = new MachineCapabilitiesCache();
    const capabilitiesPublisher = new ConvexCapabilitiesPublisher({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });

    capabilitiesCache.setHarnesses(task.workspaceId as string, [
      {
        name: 'opencode-sdk',
        displayName: 'Opencode',
        agents: [...agents],
        providers: [...providers],
      },
    ]);

    const workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    });

    const workspaceMetas = workspaces.map((ws: { _id: string; workingDir: string }) => ({
      workspaceId: ws._id as string,
      cwd: ws.workingDir,
      name: ws.workingDir,
    }));

    await publishMachineSnapshot(
      capabilitiesPublisher,
      capabilitiesCache,
      ctx.machineId,
      workspaceMetas
    );

    console.log(
      `[${formatTimestamp()}] ✅ Refresh published for workspace ${task.workspaceId} (${agents.length} agents, ${providers.length} providers)`
    );

    // Mark task as done
    await ctx.deps.backend.mutation(api.chatroom.directHarness.capabilities.completeRefreshTask, {
      sessionId: ctx.sessionId,
      taskId: task._id,
      status: 'done',
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.warn(`[${formatTimestamp()}] ❌ Refresh task ${task._id} failed: ${errorMessage}`);
    try {
      await ctx.deps.backend.mutation(api.chatroom.directHarness.capabilities.completeRefreshTask, {
        sessionId: ctx.sessionId,
        taskId: task._id,
        status: 'failed',
        errorMessage,
      });
    } catch {
      // best-effort
    }
  }
}
