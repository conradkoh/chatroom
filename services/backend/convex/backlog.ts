import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

/** Lists all active backlog items for a chatroom (status: backlog or pending_user_review). */
export const listBacklogItems = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    statusFilter: v.optional(
      v.union(
        v.literal('backlog'),
        v.literal('pending_user_review'),
        v.literal('closed'),
        v.literal('active'), // backlog + pending_user_review
      )
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    let items = await ctx.db
      .query('chatroom_backlog')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();

    // Apply status filter
    if (args.statusFilter === 'backlog') {
      items = items.filter((i) => i.status === 'backlog');
    } else if (args.statusFilter === 'pending_user_review') {
      items = items.filter((i) => i.status === 'pending_user_review');
    } else if (args.statusFilter === 'closed') {
      items = items.filter((i) => i.status === 'closed');
    } else if (args.statusFilter === 'active' || !args.statusFilter) {
      items = items.filter((i) => i.status === 'backlog' || i.status === 'pending_user_review');
    }

    // Sort by priority descending (higher first), then createdAt descending
    items.sort((a, b) => {
      const aPriority = a.priority ?? -Infinity;
      const bPriority = b.priority ?? -Infinity;
      if (aPriority !== bPriority) return bPriority - aPriority;
      return b.createdAt - a.createdAt;
    });

    const limit = Math.min(args.limit ?? 100, 100);
    return items.slice(0, limit);
  },
});

/** Creates a new backlog item. */
export const createBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    createdBy: v.string(),
    priority: v.optional(v.number()),
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (!args.content.trim()) {
      throw new ConvexError('Content cannot be empty');
    }

    const now = Date.now();
    return await ctx.db.insert('chatroom_backlog', {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content.trim(),
      status: 'backlog',
      createdAt: now,
      updatedAt: now,
      priority: args.priority,
      complexity: args.complexity,
      value: args.value,
    });
  },
});
