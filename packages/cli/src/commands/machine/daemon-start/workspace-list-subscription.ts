/**
 * Reactive subscription to recently observed workspaces for this machine.
 *
 * Populates `ctx.workspaceListStore` so git/command/commit-detail sync can read
 * locally without polling `listWorkspacesForMachine` on every heartbeat.
 */

import {
  WORKSPACE_LIST_RECONCILE_MS,
  WORKSPACE_RECENCY_WINDOW_MS,
} from '@workspace/backend/config/reliability.js';
import type { ConvexClient } from 'convex/browser';
import type { FunctionReturnType } from 'convex/server';

import type { DaemonContext, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type RecentlyObservedWorkspaces = FunctionReturnType<
  typeof api.workspaces.listRecentlyObservedWorkspacesForMachine
>;

function toSyncWorkspaces(workspaces: RecentlyObservedWorkspaces): WorkspaceForSync[] {
  return workspaces.map((ws) => ({ workingDir: ws.workingDir }));
}

function applyWorkspaceList(ctx: DaemonContext, workspaces: RecentlyObservedWorkspaces): void {
  if (!ctx.workspaceListStore) return;
  ctx.workspaceListStore.workspaces = toSyncWorkspaces(workspaces);
  ctx.workspaceListStore.updatedAt = Date.now();
}

/** Subscribe to recently observed workspaces; returns stop handle. */
export function startWorkspaceListSubscription(
  ctx: DaemonContext,
  wsClient: ConvexClient
): { stop: () => void } {
  ctx.workspaceListStore = { workspaces: [], updatedAt: 0 };

  const queryArgs = {
    sessionId: ctx.sessionId,
    machineId: ctx.machineId,
    recencyWindowMs: WORKSPACE_RECENCY_WINDOW_MS,
  };

  let stopped = false;
  let reconcileInFlight = false;

  const unsubscribe = wsClient.onUpdate(
    api.workspaces.listRecentlyObservedWorkspacesForMachine,
    queryArgs,
    (workspaces) => {
      if (stopped) return;
      applyWorkspaceList(ctx, workspaces ?? []);
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️ Workspace-list subscription error: ${getErrorMessage(err)}`
      );
    }
  );

  const reconcileTimer = setInterval(() => {
    if (stopped || reconcileInFlight) return;
    reconcileInFlight = true;
    ctx.deps.backend
      .query(api.workspaces.listRecentlyObservedWorkspacesForMachine, queryArgs)
      .then((workspaces) => {
        if (!stopped) applyWorkspaceList(ctx, workspaces ?? []);
      })
      .catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️ Workspace-list reconcile failed: ${getErrorMessage(err)}`
        );
      })
      .finally(() => {
        reconcileInFlight = false;
      });
  }, WORKSPACE_LIST_RECONCILE_MS);

  console.log(`[${formatTimestamp()}] 📂 Workspace-list subscription started`);

  return {
    stop: () => {
      stopped = true;
      unsubscribe();
      clearInterval(reconcileTimer);
      delete ctx.workspaceListStore;
      console.log(`[${formatTimestamp()}] 📂 Workspace-list subscription stopped`);
    },
  };
}
