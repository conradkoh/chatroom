/**
 * Workspace file tree — refresh contract
 * ------------------------------------
 * - Reads: always from workspaceFileTreeStore (SSOT).
 * - Hydration: useWorkspaceFileTree (producer) loads Convex snapshots into store.
 * - Freshness: useWorkspaceFileTreeDeltaSync applies Convex deltas.
 * - Daemon nudge: requestFileTree mutation via refreshWorkspaceFileTree() only.
 * - Dedup: requestWorkspaceFileTreeRefresh coalesces calls per workspace key (1.5s).
 */

/** Shared dedup window for `requestFileTree` nudges across all hook instances. */
const WORKSPACE_FILE_TREE_REFRESH_DEDUP_MS = 1500;

const lastRefreshAtByKey = new Map<string, number>();

// fallow-ignore-next-line unused-export
export function __resetWorkspaceFileTreeRefreshCoordinatorForTests(): void {
  lastRefreshAtByKey.clear();
}

/** Canonical daemon nudge entry point — delegates to dedup coordinator. */
export function refreshWorkspaceFileTree({
  workspaceKey,
  machineId,
  workingDir,
  request,
  force = false,
}: {
  workspaceKey: string;
  machineId: string;
  workingDir: string;
  request: WorkspaceFileTreeRefreshRequest;
  force?: boolean;
}): void {
  requestWorkspaceFileTreeRefresh({ workspaceKey, machineId, workingDir, force, request });
}

export type WorkspaceFileTreeRefreshRequest = (args: {
  machineId: string;
  workingDir: string;
  force?: boolean;
}) => void | Promise<unknown>;

function shouldSkipWorkspaceFileTreeRefresh(workspaceKey: string, force: boolean): boolean {
  if (force) return false;
  const last = lastRefreshAtByKey.get(workspaceKey);
  const now = Date.now();
  if (last !== undefined && now - last < WORKSPACE_FILE_TREE_REFRESH_DEDUP_MS) {
    return true;
  }
  lastRefreshAtByKey.set(workspaceKey, now);
  return false;
}

export function requestWorkspaceFileTreeRefresh({
  workspaceKey,
  machineId,
  workingDir,
  force = false,
  request,
}: {
  workspaceKey: string;
  machineId: string;
  workingDir: string;
  force?: boolean;
  request: WorkspaceFileTreeRefreshRequest;
}): void {
  if (shouldSkipWorkspaceFileTreeRefresh(workspaceKey, force)) return;

  void request({
    machineId,
    workingDir,
    ...(force ? { force: true } : {}),
  });
}
