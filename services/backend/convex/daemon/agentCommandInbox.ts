// fallow-ignore-file code-duplication
// Intentional mirror of daemon/machineCommandInbox.ts for a separate table;
// do not unify into a generic inbox framework (see slice notes).
/** Agent command inbox: dedicated agent.stop transport; watch nudges, claim/renew/ack manage the lease. */
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { MACHINE_COMMAND_CLAIM_LEASE_MS } from '../../config/reliability';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { mutation, query } from '../_generated/server';
import { requireMachineOwner } from '../auth/cli/machineAccess';

async function findNextPendingAgentCommandRow(ctx: QueryCtx | MutationCtx, machineId: string) {
  return await ctx.db
    .query('chatroom_agentCommandInbox')
    .withIndex('by_machine_status_deadline', (q) =>
      q.eq('machineId', machineId).eq('status', 'pending').gt('deadlineAt', Date.now())
    )
    .first();
}

export const watchNext = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await findNextPendingAgentCommandRow(ctx, args.machineId);
    return { commandId: row?._id ?? null };
  },
});

export const claimNext = mutation({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const row = await findNextPendingAgentCommandRow(ctx, args.machineId);
    if (!row) return null;
    await ctx.db.patch('chatroom_agentCommandInbox', row._id, {
      status: 'processing',
      claimedBySessionId: args.sessionId,
      leaseExpiresAt: Math.min(Date.now() + MACHINE_COMMAND_CLAIM_LEASE_MS, row.deadlineAt),
      attemptCount: row.attemptCount + 1,
    });
    const claimed = await ctx.db.get('chatroom_agentCommandInbox', row._id);
    if (!claimed || claimed.status !== 'processing') return null;
    return {
      commandId: claimed._id,
      machineId: claimed.machineId,
      timestamp: claimed.createdAt,
      deadline: claimed.deadlineAt,
      ...claimed.command,
    };
  },
});

export const renewClaim = mutation({
  args: { ...SessionIdArg, commandId: v.id('chatroom_agentCommandInbox') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('chatroom_agentCommandInbox', args.commandId);
    if (!row) throw new ConvexError({ code: 'NOT_FOUND', message: 'Command not found' });
    await requireMachineOwner(ctx, args.sessionId, row.machineId);
    if (row.status !== 'processing' || row.claimedBySessionId !== args.sessionId)
      throw new ConvexError({ code: 'NOT_AUTHORIZED', message: 'Not owner of command claim' });
    const leaseExpiresAt = Math.min(Date.now() + MACHINE_COMMAND_CLAIM_LEASE_MS, row.deadlineAt);
    await ctx.db.patch('chatroom_agentCommandInbox', args.commandId, { leaseExpiresAt });
    return { leaseExpiresAt };
  },
});

export const acknowledge = mutation({
  args: { ...SessionIdArg, commandId: v.id('chatroom_agentCommandInbox') },
  handler: async (ctx, args) => {
    const row = await ctx.db.get('chatroom_agentCommandInbox', args.commandId);
    if (!row) return { deleted: false };
    await requireMachineOwner(ctx, args.sessionId, row.machineId);
    if (row.status !== 'processing' || row.claimedBySessionId !== args.sessionId)
      throw new ConvexError({ code: 'NOT_AUTHORIZED', message: 'Not owner of command claim' });
    await ctx.db.delete('chatroom_agentCommandInbox', args.commandId);
    return { deleted: true };
  },
});
