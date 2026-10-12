import { normalizeWorkingDirForLookup } from './normalize-working-dir.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';

/**
 * Checks that `workingDir` is an active workspace on this machine. Membership comes from the
 * WorkspaceService, so this is a local lookup with no backend call.
 */
export async function assertRegisteredWorkingDir(
  session: Pick<DaemonSessionServiceShape, 'workspaceService'>,
  workingDir: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  return session.workspaceService.isRegistered(normalizeWorkingDirForLookup(workingDir))
    ? { ok: true }
    : { ok: false, error: 'Workspace not registered for this machine' };
}
