import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { internalMutation } from './_generated/server';

async function recoverExpiredMachineCommandClaims(ctx: MutationCtx, now: number): Promise<boolean> {
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
  return rows.length === 200;
}

async function recoverExpiredAgentCommandClaims(ctx: MutationCtx, now: number): Promise<boolean> {
  const rows = await ctx.db
    .query('chatroom_agentCommandInbox')
    .withIndex('by_status_leaseExpiresAt', (q) =>
      q.eq('status', 'processing').lt('leaseExpiresAt', now)
    )
    .take(200);
  for (const row of rows) {
    await ctx.db.delete('chatroom_agentCommandInbox', row._id);
    if (row.deadlineAt > now)
      await ctx.db.insert('chatroom_agentCommandInbox', {
        machineId: row.machineId,
        command: row.command,
        createdAt: row.createdAt,
        deadlineAt: row.deadlineAt,
        attemptCount: row.attemptCount,
        status: 'pending',
      });
  }
  return rows.length === 200;
}

async function deleteExpiredMachineCommands(ctx: MutationCtx): Promise<boolean> {
  const rows = await ctx.db
    .query('chatroom_machineCommandInbox')
    .withIndex('by_deadline', (q) => q.lt('deadline', Date.now()))
    .take(2000);
  for (const row of rows) await ctx.db.delete('chatroom_machineCommandInbox', row._id);
  return rows.length === 2000;
}

async function deleteExpiredAgentCommands(ctx: MutationCtx): Promise<boolean> {
  const rows = await ctx.db
    .query('chatroom_agentCommandInbox')
    .withIndex('by_deadline', (q) => q.lt('deadlineAt', Date.now()))
    .take(2000);
  for (const row of rows) await ctx.db.delete('chatroom_agentCommandInbox', row._id);
  return rows.length === 2000;
}

export const recoverExpiredClaims = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const machinePending = await recoverExpiredMachineCommandClaims(ctx, now);
    const agentPending = await recoverExpiredAgentCommandClaims(ctx, now);
    if (machinePending || agentPending)
      await ctx.scheduler.runAfter(0, internal.machineCommandCleanup.recoverExpiredClaims);
  },
});
export const cleanupExpiredMachineCommands = internalMutation({
  args: {},
  handler: async (ctx) => {
    const machinePending = await deleteExpiredMachineCommands(ctx);
    const agentPending = await deleteExpiredAgentCommands(ctx);
    if (machinePending || agentPending)
      await ctx.scheduler.runAfter(0, internal.machineCommandCleanup.cleanupExpiredMachineCommands);
  },
});
