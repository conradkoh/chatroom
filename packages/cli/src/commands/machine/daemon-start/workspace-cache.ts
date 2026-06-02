/**
 * Per-heartbeat cache for listWorkspacesForMachine — avoids 3 identical queries
 * per daemon tick (git, commands, commit-detail sync).
 */

import { DAEMON_HEARTBEAT_INTERVAL_MS } from '@workspace/backend/config/reliability.js';

import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type { DaemonContext, SessionId } from './types.js';
import { formatTimestamp } from './utils.js';

export interface WorkspaceForSync {
  workingDir: string;
}

interface WorkspaceCacheEntry {
  fetchedAt: number;
  workspaces: WorkspaceForSync[];
}

const CACHE_TTL_MS = DAEMON_HEARTBEAT_INTERVAL_MS;

/** Drop cached workspace list (call at start of each daemon heartbeat tick). */
export function invalidateWorkspacesForMachineCache(ctx: DaemonContext): void {
  delete (ctx as DaemonContext & { _workspacesCache?: WorkspaceCacheEntry })._workspacesCache;
}

/** Returns workspaces for this machine, reusing the in-memory cache within one heartbeat tick. */
export async function getWorkspacesForMachine(
  ctx: DaemonContext
): Promise<WorkspaceForSync[]> {
  const extended = ctx as DaemonContext & { _workspacesCache?: WorkspaceCacheEntry };
  const now = Date.now();
  const cached = extended._workspacesCache;
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.workspaces;
  }

  try {
    const workspaces = (await ctx.deps.backend.query(api.workspaces.listWorkspacesForMachine, {
      sessionId: ctx.sessionId as SessionId,
      machineId: ctx.machineId,
    })) as WorkspaceForSync[];
    extended._workspacesCache = { fetchedAt: now, workspaces };
    return workspaces;
  } catch (err) {
    console.warn(
      `[${formatTimestamp()}] ⚠️ Failed to query workspaces: ${getErrorMessage(err)}`
    );
    return [];
  }
}
