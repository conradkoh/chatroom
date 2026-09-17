/**
 * Releases every non-pending task the machine's roles hold back to `pending`.
 *
 * Called on daemon shutdown: the daemon knows for certain that no agent on the
 * machine is processing anything once it exits, so every `acknowledged` /
 * `in_progress` task assigned to a machine-owned role is handed back for
 * reprocessing on the next daemon boot.
 *
 * The backend still stores task status, so the release runs as a backend
 * mutation scoped to the machine's launch requests — broader than the daemon's
 * local read model, which may have lost track of roles.
 */

import { transitionInFlightTasksToPending } from './release-tasks-on-agent-exit';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { listCurrentRemoteRequests } from '../machine/list-assigned-task-status-for-machine';

export async function releaseTasksOnDaemonShutdown(
  ctx: MutationCtx,
  args: { machineId: string }
): Promise<number> {
  const requests = await listCurrentRemoteRequests(ctx, args.machineId);
  let released = 0;
  for (const request of requests) {
    released += await transitionInFlightTasksToPending(ctx, {
      chatroomId: request.chatroomId,
      trigger: 'releaseTasksOnDaemonShutdown',
      assignedTo: request.role,
    });
  }
  return released;
}
