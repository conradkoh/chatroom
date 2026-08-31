/**
 * Workspace list store — populated by inbound `daemon.workspaceListChanged` nudges
 * and one-shot startup reconcile. No polling.
 */

import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';

import { api } from '../../../api.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import type { WorkspaceForSync } from '../daemon-types.js';

type RecentlyObservedWorkspaces = FunctionReturnType<
  typeof api.workspaces.listRecentlyObservedWorkspacesForMachine
>;

function toSyncWorkspaces(workingDirs: RecentlyObservedWorkspaces): WorkspaceForSync[] {
  return workingDirs.map((workingDir) => ({ workingDir }));
}

export async function reconcileWorkspaceList(session: DaemonSessionServiceShape): Promise<void> {
  const workspaces = await session.backend.query(
    api.workspaces.listRecentlyObservedWorkspacesForMachine,
    {
      sessionId: session.sessionId,
      machineId: session.machineId,
    }
  );
  if (!session.workspaceListStore) {
    session.workspaceListStore = { workspaces: [], updatedAt: 0 };
  }
  session.workspaceListStore.workspaces = toSyncWorkspaces(workspaces);
  session.workspaceListStore.updatedAt = Date.now();
}

/** Initialize workspace list store (no WS). Call `reconcileWorkspaceList` on inbound nudges. */
export const startWorkspaceListSubscriptionEffect = (): Effect.Effect<
  { stop: () => void },
  never,
  DaemonSessionService
> =>
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    session.workspaceListStore = { workspaces: [], updatedAt: 0 };
    yield* Effect.promise(() => reconcileWorkspaceList(session));

    return {
      stop: () => {
        session.workspaceListStore = undefined;
      },
    };
  });
