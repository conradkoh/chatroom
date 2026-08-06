import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';
import { getWorkspacesForMachine } from '../../../daemon/entry/workspace-git/workspace-cache.js';

export async function assertRegisteredWorkingDir(
  session: DaemonSessionServiceShape,
  workingDir: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const workspaces = await getWorkspacesForMachine({
    workspaceListStore: session.workspaceListStore,
    sessionId: session.sessionId,
    machineId: session.machineId,
    backend: session.backend,
  });
  const normalizedWorkingDir = normalizeWorkingDirForLookup(workingDir);
  if (
    !workspaces.some((w) => normalizeWorkingDirForLookup(w.workingDir) === normalizedWorkingDir)
  ) {
    return { ok: false, error: 'Workspace not registered for this machine' };
  }
  return { ok: true };
}
