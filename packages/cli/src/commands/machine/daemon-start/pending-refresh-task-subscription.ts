/**
 * Reactive subscription for pending capability refresh tasks in the direct-harness daemon.
 *
 * Subscribes to `getPendingRefreshTasksForMachine` via the Convex WebSocket client.
 * When pending refresh tasks appear, the daemon re-discovers harness capabilities
 * and republishes via the existing publishMachineSnapshot path.
 */

import { featureFlags } from '@workspace/backend/config/featureFlags.js';
import type { ConvexClient } from 'convex/browser';

import { publishCapabilities } from '../../../domain/direct-harness/usecases/publish-capabilities.js';
import type { CapabilitiesCollector } from '../../../domain/direct-harness/usecases/publish-capabilities.js';
import type { BoundHarness } from '../../../domain/direct-harness/entities/bound-harness.js';
import { InMemoryCollectorRegistry } from '../../../infrastructure/repos/convex-collector-resolver.js';
import type { DaemonContext } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import { ConvexCapabilitiesPublisher } from '../../../infrastructure/repos/convex-capabilities-publisher.js';
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
  harnesses: Map<string, BoundHarness>
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
      void drainRefreshTasks(ctx, harnesses, pendingTasks)
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
  harnesses: Map<string, BoundHarness>,
  pendingTasks: Array<{
    _id: Id<'chatroom_pendingDaemonTasks'>;
    workspaceId: Id<'chatroom_workspaces'>;
    taskType: string;
  }>
): Promise<void> {
  for (const task of pendingTasks) {
    await executeRefreshTask(ctx, harnesses, task);
  }
}

/**
 * Execute a single refresh task by re-discovering harness capabilities
 * for the task's workspace and republishing the machine snapshot.
 */
async function executeRefreshTask(
  ctx: DaemonContext,
  harnesses: Map<string, BoundHarness>,
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
    }) as { workingDir: string } | null;

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

    // Get the running harness for this workspace (if any)
    const harness = harnesses.get(task.workspaceId as string);
    if (!harness) {
      console.warn(
        `[${formatTimestamp()}] ⚠️  No running harness for workspace ${task.workspaceId} — publishing empty capabilities`
      );
    }

    // Build a temporary collector registry for publishing
    const registry = new InMemoryCollectorRegistry();
    if (harness) {
      const models = await harness.models();

      const collector: CapabilitiesCollector = {
        name: 'opencode-sdk',
        displayName: 'Opencode',
        listAgents: async () =>
          models.map((m) => ({
            name: m.id,
            mode: 'primary' as const,
            model: { providerID: m.provider, modelID: m.id },
          })),
        listProviders: async () => {
          const grouped = new Map<string, { providerID: string; name: string; models: { modelID: string; name: string }[] }>();
          for (const m of models) {
            if (!grouped.has(m.provider)) {
              grouped.set(m.provider, { providerID: m.provider, name: m.provider, models: [] });
            }
            grouped.get(m.provider)!.models.push({ modelID: m.id, name: m.name });
          }
          return [...grouped.values()];
        },
      };

      registry.register(task.workspaceId as string, {
        workspaceId: task.workspaceId as string,
        cwd: workspace.workingDir,
        name: workspace.workingDir,
        harnesses: [],
      }, collector);
    }

    // Publish via domain use case
    const publisher = new ConvexCapabilitiesPublisher({
      backend: ctx.deps.backend,
      sessionId: ctx.sessionId,
    });

    const workspaces = await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId,
      machineId: ctx.machineId,
    }) as Array<{ _id: string; workingDir: string }>;

    const baseWorkspaces = workspaces.map((ws) => ({
      workspaceId: ws._id,
      cwd: ws.workingDir,
      name: ws.workingDir,
      harnesses: [] as never[],
    }));

    await publishCapabilities(
      { collectorResolver: registry, publisher, machineId: ctx.machineId },
      { workspaces: baseWorkspaces }
    );

    console.log(`[${formatTimestamp()}] ✅ Refresh published for workspace ${task.workspaceId}`);

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
