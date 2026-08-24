import { internal } from './_generated/api';
import { internalMutation } from './_generated/server';

export const recoverExpiredClaims = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_status_leaseExpiresAt', (q) =>
        q.eq('status', 'processing').lt('leaseExpiresAt', now)
      )
      .take(200);
    for (const row of rows) {
      await ctx.db.delete('chatroom_machineCommandInbox', row._id);
      if (row.deadline > now)
        await ctx.db.insert('chatroom_machineCommandInbox', {
          machineId: row.machineId,
          command: row.command,
          createdAt: row.createdAt,
          deadline: row.deadline,
          attemptCount: row.attemptCount,
          status: 'pending',
        });
    }
    if (rows.length === 200)
      await ctx.scheduler.runAfter(0, internal.machineCommandCleanup.recoverExpiredClaims);
  },
});
export const cleanupExpiredMachineCommands = internalMutation({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_deadline', (q) => q.lt('deadline', Date.now()))
      .take(2000);
    for (const row of rows) await ctx.db.delete('chatroom_machineCommandInbox', row._id);
    if (rows.length === 2000)
      await ctx.scheduler.runAfter(0, internal.machineCommandCleanup.cleanupExpiredMachineCommands);
  },
});
