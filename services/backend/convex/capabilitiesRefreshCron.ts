import { internalMutation } from './_generated/server';

const STALE_PENDING_MS = 48 * 60 * 60 * 1000;
const BATCH_PAGE_SIZE = 100;

/**
 * Marks long-pending capabilities refresh batches as failed so the UI does not
 * spin forever when a daemon never reports.
 */
export const expireStalePendingCapabilitiesRefreshBatches = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - STALE_PENDING_MS;

    const staleBatches = await ctx.db
      .query('chatroom_capabilities_refresh_batches')
      .withIndex('by_aggregateStatus_created', (q) =>
        q.eq('aggregateStatus', 'pending').lt('createdAt', cutoff)
      )
      .take(BATCH_PAGE_SIZE);

    for (const batch of staleBatches) {
      const rows = await ctx.db
        .query('chatroom_capabilities_refresh_machine_results')
        .withIndex('by_batchId', (q) => q.eq('batchId', batch._id))
        .collect();

      for (const row of rows) {
        if (row.status === 'pending') {
          await ctx.db.patch('chatroom_capabilities_refresh_machine_results', row._id, {
            status: 'failed',
            finishedAt: now,
            errorMessage: 'Timed out waiting for daemon report.',
          });
        }
      }

      const updatedRows = await ctx.db
        .query('chatroom_capabilities_refresh_machine_results')
        .withIndex('by_batchId', (q) => q.eq('batchId', batch._id))
        .collect();

      const finishedCount = updatedRows.filter((r) => r.status !== 'pending').length;
      const failedCount = updatedRows.filter((r) => r.status === 'failed').length;
      const aggregateStatus =
        failedCount === 0 ? 'completed' : failedCount === updatedRows.length ? 'failed' : 'partial';

      await ctx.db.patch('chatroom_capabilities_refresh_batches', batch._id, {
        finishedMachineCount: finishedCount,
        aggregateStatus,
      });
    }
  },
});
