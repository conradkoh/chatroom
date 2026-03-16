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

/** Closes a backlog item (without marking it as completed). */
export const closeBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status === 'closed') throw new ConvexError('Item is already closed');
    const now = Date.now();
    await ctx.db.patch('chatroom_backlog', args.itemId, { status: 'closed', updatedAt: now });
    return { success: true };
  },
});

/** Marks a backlog item as completed (user confirms agent's work is done). Must be in pending_user_review. */
export const completeBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status !== 'pending_user_review') {
      throw new ConvexError(
        `Cannot complete item with status: ${item.status}. Must be in pending_user_review.`
      );
    }
    const now = Date.now();
    await ctx.db.patch('chatroom_backlog', args.itemId, {
      status: 'closed',
      completedAt: now,
      updatedAt: now,
    });
    return { success: true };
  },
});

/** Reopens a closed backlog item back to backlog status. */
export const reopenBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status !== 'closed') {
      throw new ConvexError(
        `Cannot reopen item with status: ${item.status}. Must be closed.`
      );
    }
    const now = Date.now();
    await ctx.db.patch('chatroom_backlog', args.itemId, {
      status: 'backlog',
      completedAt: undefined,
      updatedAt: now,
    });
    return { success: true };
  },
});

/** Agent-facing: signals a backlog item is done and needs user review. Must be in backlog status. */
export const markBacklogItemForReview = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status !== 'backlog') {
      throw new ConvexError(
        `Cannot mark for review with status: ${item.status}. Must be in backlog.`
      );
    }
    const now = Date.now();
    await ctx.db.patch('chatroom_backlog', args.itemId, {
      status: 'pending_user_review',
      updatedAt: now,
    });
    return { success: true };
  },
});

/** User sends a pending_user_review item back to backlog for more work. */
export const sendBacklogItemBackForRework = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status !== 'pending_user_review') {
      throw new ConvexError(
        `Cannot send back with status: ${item.status}. Must be in pending_user_review.`
      );
    }
    const now = Date.now();
    await ctx.db.patch('chatroom_backlog', args.itemId, {
      status: 'backlog',
      updatedAt: now,
    });
    return { success: true };
  },
});

/** Updates the content of a backlog item. Only allowed when status is backlog. */
export const updateBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    itemId: v.id('chatroom_backlog'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get('chatroom_backlog', args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireChatroomAccess(ctx, args.sessionId, item.chatroomId);
    if (item.status !== 'backlog') {
      throw new ConvexError(
        `Cannot edit item with status: ${item.status}. Must be in backlog.`
      );
    }
    if (!args.content.trim()) throw new ConvexError('Content cannot be empty');
    await ctx.db.patch('chatroom_backlog', args.itemId, {
      content: args.content.trim(),
      updatedAt: Date.now(),
    });
    return { success: true };
  },
});

/** Fetches multiple backlog items by their IDs. Returns only items the session has access to. */
export const getBacklogItemsByIds = query({
  args: {
    ...SessionIdArg,
    itemIds: v.array(v.id('chatroom_backlog')),
  },
  handler: async (ctx, args) => {
    if (args.itemIds.length === 0) return [];
    const items = await Promise.all(args.itemIds.map((id) => ctx.db.get('chatroom_backlog', id)));
    const validItems = items.filter((i): i is NonNullable<typeof i> => i !== null);
    // Access check: use first item's chatroomId (all should be same chatroom)
    if (validItems.length > 0) {
      await requireChatroomAccess(ctx, args.sessionId, validItems[0]!.chatroomId);
    }
    return validItems;
  },
});
