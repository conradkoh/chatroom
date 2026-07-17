/** Shared dedup window for `requestFileTree` nudges across all hook instances. */
const WORKSPACE_FILE_TREE_REFRESH_DEDUP_MS = 1500;

const lastRefreshAtByKey = new Map<string, number>();

// fallow-ignore-next-line unused-export
export function __resetWorkspaceFileTreeRefreshCoordinatorForTests(): void {
  lastRefreshAtByKey.clear();
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
