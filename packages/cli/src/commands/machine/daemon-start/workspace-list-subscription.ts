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
import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

type RecentlyObservedWorkspaces = FunctionReturnType<
  typeof api.workspaces.listRecentlyObservedWorkspacesForMachine
>;

function toSyncWorkspaces(workspaces: RecentlyObservedWorkspaces): WorkspaceForSync[] {
  return workspaces.map((ws) => ({ workingDir: ws.workingDir }));
}

// ── Minimal dep type used by Core functions + Effect twins ────────────────────

/**
 * Flat deps for the workspace-list subscription Core function.
 * DaemonSessionServiceShape structurally satisfies this type.
 */
export type WorkspaceListSubscriptionDeps = {
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
};

/**
 * Mutable holder for the workspace-list store.
 *
 * The Core function reads/writes `storeHolder.workspaceListStore` directly so that
 * mutations are visible to the real ctx (wrapper) or the real session service (Effect twin).
 * Both DaemonContext and DaemonSessionServiceShape have this optional field.
 */
export type WorkspaceListStoreHolder = {
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
};

// ── Core implementation (flat deps, no ctx.deps.xxx) ─────────────────────────

function startWorkspaceListSubscriptionCore(
  deps: WorkspaceListSubscriptionDeps,
  storeHolder: WorkspaceListStoreHolder,
  wsClient: ConvexClient
): { stop: () => void } {
  // Initialize the store on the holder so downstream consumers see it
  storeHolder.workspaceListStore = { workspaces: [], updatedAt: 0 };

  const queryArgs = {
    sessionId: deps.sessionId,
    machineId: deps.machineId,
    recencyWindowMs: WORKSPACE_RECENCY_WINDOW_MS,
  };

  let stopped = false;
  let reconcileInFlight = false;

  const applyList = (workspaces: RecentlyObservedWorkspaces): void => {
    if (!storeHolder.workspaceListStore) return;
    storeHolder.workspaceListStore.workspaces = toSyncWorkspaces(workspaces);
    storeHolder.workspaceListStore.updatedAt = Date.now();
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
    deps.backend
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
      // Clear the store so workspace-cache.ts falls back to a query (same semantics as delete)
      storeHolder.workspaceListStore = undefined;
      console.log(`[${formatTimestamp()}] 📂 Workspace-list subscription stopped`);
    },
  };
}

// ── Public wrapper (backward-compat — old call sites in command-loop.ts) ──────

// ── Effect twin ───────────────────────────────────────────────────────────────

/**
 * Effect twin for startWorkspaceListSubscription.
 * Yields DaemonSessionService; the session object is passed as BOTH deps and storeHolder:
 *   - deps:        DaemonSessionServiceShape satisfies WorkspaceListSubscriptionDeps
 *                  (has sessionId, machineId, backend)
 *   - storeHolder: DaemonSessionServiceShape satisfies WorkspaceListStoreHolder
 *                  (has workspaceListStore?)
 * Core mutates session.workspaceListStore in place; Layer.succeed provides the SAME
 * object instance on every yield, so downstream heartbeat Effect twins see the update.
 */
export const startWorkspaceListSubscriptionEffect = (
  wsClient: ConvexClient
): Effect.Effect<{ stop: () => void }, never, DaemonSessionService> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    return startWorkspaceListSubscriptionCore(session, session, wsClient);
  });
