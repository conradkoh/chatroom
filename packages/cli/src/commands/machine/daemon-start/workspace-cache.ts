/**
 * Workspace list access for daemon sync paths.
 *
 * Reads from `workspaceListStore` (reactive subscription) when available;
 * falls back to a one-shot query before the subscription delivers its first value.
 */

import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type { DaemonContext, SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';

export type { WorkspaceForSync };

/** Returns workspaces for this machine from the subscription store or a fallback query. */
export async function getWorkspacesForMachine(
  ctx: DaemonContext
): Promise<WorkspaceForSync[]> {
  const store = ctx.workspaceListStore;
  if (store && store.updatedAt > 0) {
    return store.workspaces;
  }

  try {
    const workspaces = (await ctx.deps.backend.query(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      {
        sessionId: ctx.sessionId as SessionId,
        machineId: ctx.machineId,
      }
    )) as { workingDir: string }[];
    const mapped = workspaces.map((ws) => ({ workingDir: ws.workingDir }));
    if (store) {
      store.workspaces = mapped;
      store.updatedAt = Date.now();
    }
    return mapped;
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces: ${getErrorMessage(err)}`
    );
    return [];
  }
}
