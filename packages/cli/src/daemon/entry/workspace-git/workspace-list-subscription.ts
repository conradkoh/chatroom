/**
 * Workspace list store — populated by v2 `workspace-list` subscriber inbound nudges.
 *
 * Legacy WS `onUpdate` and reconcile timer removed in U13.
 */

import {
  OBSERVATION_TTL_MS,
  OBSERVED_SAFETY_POLL_MS,
} from '@workspace/backend/config/reliability.js';
import type { FunctionReturnType } from 'convex/server';
import { Effect } from 'effect';

import { api } from '../../../api.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import type { WorkspaceForSync } from '../daemon-types.js';

type RecentlyObservedWorkspaces = NonNullable<
  FunctionReturnType<typeof api.workspaces.listRecentlyObservedWorkspacesForMachine>
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
      recencyWindowMs: OBSERVATION_TTL_MS,
    }
  );
  if (workspaces == null) return;
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

    const interval = setInterval(() => {
      void reconcileWorkspaceList(session).catch(() => undefined);
    }, OBSERVED_SAFETY_POLL_MS);
    return {
      stop: () => {
        clearInterval(interval);
        session.workspaceListStore = undefined;
      },
    };
  });
