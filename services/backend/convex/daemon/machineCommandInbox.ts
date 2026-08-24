import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { MACHINE_COMMAND_CLAIM_LEASE_MS } from '../../config/reliability';
import { mutation, query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

export const watchNext = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, a) => {
    await requireMachineOwner(ctx, a.sessionId, a.machineId);
    const row = await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', a.machineId).eq('status', 'pending').gt('deadline', Date.now())
      )
      .first();
    return { commandId: row?._id ?? null };
  },
});
export const claimNext = mutation({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, a) => {
    await requireMachineOwner(ctx, a.sessionId, a.machineId);
    const row = await ctx.db
      .query('chatroom_machineCommandInbox')
      .withIndex('by_machine_status_deadline', (q) =>
        q.eq('machineId', a.machineId).eq('status', 'pending').gt('deadline', Date.now())
      )
      .first();
    if (!row) return null;
    const leaseExpiresAt = Math.min(Date.now() + MACHINE_COMMAND_CLAIM_LEASE_MS, row.deadline);
    await ctx.db.patch('chatroom_machineCommandInbox', row._id, {
      status: 'processing',
      claimedBySessionId: a.sessionId,
      leaseExpiresAt,
      attemptCount: row.attemptCount + 1,
    });
    return {
      commandId: row._id,
      machineId: row.machineId,
      deadline: row.deadline,
      timestamp: row.createdAt,
      ...row.command,
    };
  },
});
export const renewClaim = mutation({
  args: { ...SessionIdArg, commandId: v.id('chatroom_machineCommandInbox') },
  handler: async (ctx, a) => {
    const row = await ctx.db.get('chatroom_machineCommandInbox', a.commandId);
    if (!row) throw new ConvexError('NOT_FOUND');
    await requireMachineOwner(ctx, a.sessionId, row.machineId);
    if (row.status !== 'processing' || row.claimedBySessionId !== a.sessionId)
      throw new ConvexError('NOT_AUTHORIZED');
    const leaseExpiresAt = Math.min(Date.now() + MACHINE_COMMAND_CLAIM_LEASE_MS, row.deadline);
    await ctx.db.patch('chatroom_machineCommandInbox', a.commandId, { leaseExpiresAt });
    return { leaseExpiresAt };
  },
});
export const acknowledge = mutation({
  args: { ...SessionIdArg, commandId: v.id('chatroom_machineCommandInbox') },
  handler: async (ctx, a) => {
    const row = await ctx.db.get('chatroom_machineCommandInbox', a.commandId);
    if (!row) return { deleted: false };
    await requireMachineOwner(ctx, a.sessionId, row.machineId);
    if (row.status !== 'processing' || row.claimedBySessionId !== a.sessionId)
      throw new ConvexError('NOT_AUTHORIZED');
    await ctx.db.delete('chatroom_machineCommandInbox', a.commandId);
    return { deleted: true };
  },
});
