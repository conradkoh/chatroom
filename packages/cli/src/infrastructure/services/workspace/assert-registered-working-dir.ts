import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';
import { getWorkspacesForMachine } from '../../../commands/machine/daemon-start/workspace-cache.js';

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
  if (!workspaces.some((w) => w.workingDir === workingDir)) {
    return { ok: false, error: 'Workspace not registered for this machine' };
  }
  return { ok: true };
}
