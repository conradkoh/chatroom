import { internalMutation } from './_generated/server';
import { isFileTreeWatchLeaseActive, upsertPendingFileTreeReleaseRequest } from './workspaceFiles';

/** Queue coordinator releases for UI watches whose renewable lease expired. */
export const expireFileTreeWatchLeases = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const watches = await ctx.db.query('chatroom_workspaceFileTreeWatches').collect();
    for (const row of watches) {
      if (isFileTreeWatchLeaseActive(row, now)) continue;
      if (row.watchCount <= 0) continue;
      await upsertPendingFileTreeReleaseRequest(ctx, row.machineId, row.workingDir);
    }
  },
});
