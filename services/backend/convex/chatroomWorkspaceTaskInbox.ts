import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from './_generated/server';
import { requireMachineOwner } from './auth/cli/machineAccess';
import { WorkspaceTaskInboxEventStatus } from '../src/domain/entities/chatroom-workspace-task-inbox';

const DEFAULT_INBOX_EVENT_LIMIT = 25;
const MAX_INBOX_EVENT_LIMIT = 200;

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

/**
 * Diagnostic history of this machine's task inbox events for one chatroom,
 * newest first, including already-processed rows. `listPending` only exposes
 * unacknowledged work, which cannot distinguish "never notified" from
 * "notified and acknowledged without delivery".
 */
export const listForChatroom = query({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireMachineOwner(ctx, args.sessionId, args.machineId);
    const limit = Math.min(args.limit ?? DEFAULT_INBOX_EVENT_LIMIT, MAX_INBOX_EVENT_LIMIT);
    const events = await ctx.db
      .query('chatroomWorkspaceTaskInbox')
      .withIndex('by_chatroom_taskId', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    return events
      .filter((event) => event.machineId === args.machineId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
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
