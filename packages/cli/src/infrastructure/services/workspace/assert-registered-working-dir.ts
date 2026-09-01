import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';
import { getWorkspacesForMachine } from '../../../daemon/entry/workspace-git/workspace-cache.js';

export async function assertRegisteredWorkingDir(
  session: DaemonSessionServiceShape,
  workingDir: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const normalizedWorkingDir = normalizeWorkingDirForLookup(workingDir);
  const deps = {
    workspaceListStore: session.workspaceListStore,
    sessionId: session.sessionId,
    machineId: session.machineId,
    backend: session.backend,
  } as const;

  const isRegistered = (workspaces: Awaited<ReturnType<typeof getWorkspacesForMachine>>) =>
    workspaces.some(
      (workspace) => normalizeWorkingDirForLookup(workspace.workingDir) === normalizedWorkingDir
    );

  if (isRegistered(await getWorkspacesForMachine(deps))) {
    return { ok: true };
  }

  if (isRegistered(await getWorkspacesForMachine({ ...deps, forceRefresh: true }))) {
    return { ok: true };
  }

  return { ok: false, error: 'Workspace not registered for this machine' };
}
