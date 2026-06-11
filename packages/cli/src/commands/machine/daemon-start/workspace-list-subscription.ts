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
import { Effect } from 'effect';

import { DaemonSessionService } from './daemon-services.js';
import type { WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type RecentlyObservedWorkspaces = FunctionReturnType<
  typeof api.workspaces.listRecentlyObservedWorkspacesForMachine
>;

function toSyncWorkspaces(workspaces: RecentlyObservedWorkspaces): WorkspaceForSync[] {
  return workspaces.map((ws) => ({ workingDir: ws.workingDir }));
}

export const startWorkspaceListSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<{ stop: () => void }, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;

    session.workspaceListStore = { workspaces: [], updatedAt: 0 };

    const queryArgs = {
      sessionId: session.sessionId,
      machineId: session.machineId,
      recencyWindowMs: WORKSPACE_RECENCY_WINDOW_MS,
    };

    let stopped = false;
    let reconcileInFlight = false;

    const applyList = (workspaces: RecentlyObservedWorkspaces): void => {
      if (!session.workspaceListStore) return;
      session.workspaceListStore.workspaces = toSyncWorkspaces(workspaces);
      session.workspaceListStore.updatedAt = Date.now();
    };

    const unsubscribe = wsClient.onUpdate(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      queryArgs,
      (workspaces) => {
        if (stopped) return;
        applyList(workspaces ?? []);
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
      session.backend
        .query(api.workspaces.listRecentlyObservedWorkspacesForMachine, queryArgs)
        .then((workspaces) => {
          if (!stopped) applyList(workspaces ?? []);
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
        session.workspaceListStore = undefined;
        console.log(`[${formatTimestamp()}] 📂 Workspace-list subscription stopped`);
      },
    };
  });
