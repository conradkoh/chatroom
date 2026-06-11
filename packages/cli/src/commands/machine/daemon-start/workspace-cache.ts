/**
 * Workspace list access for daemon sync paths.
 *
 * Reads from `workspaceListStore` (reactive subscription) when available;
 * falls back to a one-shot query before the subscription delivers its first value.
 */

import type { SessionId, WorkspaceForSync } from './types.js';
import { formatTimestamp } from './utils.js';
import { api } from '../../../api.js';
import type { BackendOps } from '../../../infrastructure/deps/index.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

export type { WorkspaceForSync };

/** Minimal flat deps required by getWorkspacesForMachine. */
export type WorkspaceCacheDeps = {
  workspaceListStore?: { workspaces: WorkspaceForSync[]; updatedAt: number };
  sessionId: SessionId;
  machineId: string;
  backend: BackendOps;
};

/** Returns workspaces for this machine from the subscription store or a fallback query. */
export async function getWorkspacesForMachine(
  deps: WorkspaceCacheDeps
): Promise<WorkspaceForSync[]> {
  const store = deps.workspaceListStore;
  if (store && store.updatedAt > 0) {
    return store.workspaces;
  }

  try {
    const workspaces = (await deps.backend.query(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      }
    )) as { workingDir: string }[];
    const mapped = workspaces.map((ws) => ({ workingDir: ws.workingDir }));
    if (store) {
      store.workspaces = mapped;
      store.updatedAt = Date.now();
    }
    return mapped;
  } catch (err) {
    console.warn(`[${formatTimestamp()}] ⚠️ Failed to query workspaces: ${getErrorMessage(err)}`);
    return [];
  }
}
