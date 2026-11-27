import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { upsertPendingFileTreeReleaseRequest } from '../../../../convex/workspaceFiles';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

/**
 * Tears down all file-tree sync state for a workspace after sync is disabled.
 * Zeros the watch lease, cancels any pending request, and queues a daemon release.
 * Does not clear cached file-tree data.
 */
export async function disableFileTreeSyncLifecycle(
  ctx: MutationCtx,
  workspace: Doc<'chatroom_workspaces'>,
  now: number
): Promise<void> {
  const workingDir = normalizeWorkingDir(workspace.workingDir);
  const { machineId } = workspace;

  const watchRow = await ctx.db
    .query('chatroom_workspaceFileTreeWatches')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
  if (watchRow) {
    await ctx.db.patch('chatroom_workspaceFileTreeWatches', watchRow._id, {
      watchCount: 0,
      expiresAt: undefined,
      updatedAt: now,
    });
  }

  const pendingRequest = await ctx.db
    .query('chatroom_workspaceFileTreeRequests')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .first();
  if (pendingRequest?.status === 'pending') {
    await ctx.db.patch('chatroom_workspaceFileTreeRequests', pendingRequest._id, {
      status: 'done',
      updatedAt: now,
    });
  }

  await upsertPendingFileTreeReleaseRequest(ctx, machineId, workingDir);
}
