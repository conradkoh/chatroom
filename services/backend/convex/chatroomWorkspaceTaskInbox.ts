import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { WorkspaceTaskInboxEventStatus } from '../src/domain/entities/chatroom-workspace-task-inbox';

export const listPending = query({
  args: { ...SessionIdArg, machineId: v.string() },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    return await ctx.db
      .query('chatroomWorkspaceTaskInbox')
      .withIndex('by_machine_status_createdAt', (q) =>
        q.eq('machineId', args.machineId).eq('status', WorkspaceTaskInboxEventStatus.Pending)
      )
      .order('asc')
      .collect();
  },
});

export const markProcessed = mutation({
  args: { ...SessionIdArg, machineId: v.string(), eventId: v.id('chatroomWorkspaceTaskInbox') },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const event = await ctx.db.get('chatroomWorkspaceTaskInbox', args.eventId);
    if (!event || event.machineId !== args.machineId) return { processed: false };
    if (event.status === WorkspaceTaskInboxEventStatus.Processed) return { processed: false };
    await ctx.db.patch('chatroomWorkspaceTaskInbox', args.eventId, {
      status: WorkspaceTaskInboxEventStatus.Processed,
      processedAt: Date.now(),
    });
    return { processed: true };
  },
});
