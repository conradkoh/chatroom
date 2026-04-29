import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';
import { closeBacklogItem as closeBacklogItemUseCase } from '../src/domain/usecase/backlog/close-backlog-item';
import { completeBacklogItem as completeBacklogItemUseCase } from '../src/domain/usecase/backlog/complete-backlog-item';
import { createBacklogItem as createBacklogItemUseCase } from '../src/domain/usecase/backlog/create-backlog-item';
import { getBacklogItemsByIds as getBacklogItemsByIdsUseCase } from '../src/domain/usecase/backlog/get-backlog-items-by-ids';
import { listBacklogItems as listBacklogItemsUseCase } from '../src/domain/usecase/backlog/list-backlog-items';
import { completeAllPendingReviewBacklogItems as completeAllPendingReviewBacklogItemsUseCase } from '../src/domain/usecase/backlog/complete-all-pending-review-backlog-items';
import { markBacklogItemForReview as markBacklogItemForReviewUseCase } from '../src/domain/usecase/backlog/mark-backlog-item-for-review';
import { patchBacklogItem as patchBacklogItemUseCase } from '../src/domain/usecase/backlog/patch-backlog-item';
import { reopenBacklogItem as reopenBacklogItemUseCase } from '../src/domain/usecase/backlog/reopen-backlog-item';
import { sendBacklogItemBackForRework as sendBacklogItemBackForReworkUseCase } from '../src/domain/usecase/backlog/send-backlog-item-back-for-rework';
import { updateBacklogItem as updateBacklogItemUseCase } from '../src/domain/usecase/backlog/update-backlog-item';

/** Ensures the session can access the chatroom and the backlog item lives in that chatroom. */
async function requireBacklogItemForChatroom(
  ctx: MutationCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  item: Doc<'chatroom_backlog'>
): Promise<void> {
  await requireChatroomAccess(ctx, sessionId, chatroomId);
  if (item.chatroomId !== chatroomId) {
    throw new ConvexError('Backlog item does not belong to this chatroom');
  }
}

/** Lists backlog items for a chatroom. statusFilter defaults to 'backlog' (excludes pending_user_review). */
export const listBacklogItems = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    statusFilter: v.optional(
      v.union(
        v.literal('backlog'),
        v.literal('pending_user_review'),
        v.literal('closed'),
        v.literal('active') // backlog + pending_user_review
      )
    ),
    sort: v.optional(v.union(v.literal('date:desc'), v.literal('priority:desc'))),
    filter: v.optional(v.literal('unscored')),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return await listBacklogItemsUseCase(ctx, {
      chatroomId: args.chatroomId,
      statusFilter: args.statusFilter,
      sort: args.sort,
      filter: args.filter,
      limit: args.limit,
    });
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
    const { itemId } = await createBacklogItemUseCase(ctx, {
      chatroomId: args.chatroomId,
      createdBy: args.createdBy,
      content: args.content,
      priority: args.priority,
      complexity: args.complexity,
      value: args.value,
    });
    return itemId;
  },
});

/** Closes a backlog item (without marking it as completed). */
export const closeBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    const reason = args.reason.trim();
    if (reason.length === 0) {
      throw new ConvexError('Reason cannot be empty');
    }
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await closeBacklogItemUseCase(ctx, item, { reason });
    return { success: true };
  },
});

/** Marks a backlog item as completed (user confirms agent's work is done). Must be in pending_user_review. */
export const completeBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await completeBacklogItemUseCase(ctx, args.itemId);
    return { success: true };
  },
});

/** Completes all backlog items that are in pending_user_review status for a chatroom. */
export const completeAllPendingReviewBacklogItems = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const completed = await completeAllPendingReviewBacklogItemsUseCase(ctx, args.chatroomId);
    return { completed };
  },
});

/** Reopens a closed backlog item back to backlog status. */
export const reopenBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await reopenBacklogItemUseCase(ctx, args.itemId);
    return { success: true };
  },
});

/** Agent-facing: signals a backlog item is done and needs user review. Must be in backlog status. */
export const markBacklogItemForReview = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await markBacklogItemForReviewUseCase(ctx, args.itemId);
    return { success: true };
  },
});

/** User sends a pending_user_review item back to backlog for more work. */
export const sendBacklogItemBackForRework = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await sendBacklogItemBackForReworkUseCase(ctx, args.itemId);
    return { success: true };
  },
});

/** Updates the content of a backlog item. Only allowed when status is backlog. */
export const updateBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await updateBacklogItemUseCase(ctx, { itemId: args.itemId, content: args.content });
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
    const items = await getBacklogItemsByIdsUseCase(ctx, args.itemIds);
    if (items.length > 0) {
      await requireChatroomAccess(ctx, args.sessionId, items[0]!.chatroomId);
    }
    return items;
  },
});

/** Updates priority, complexity, or value of a backlog item. */
export const patchBacklogItem = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    itemId: v.id('chatroom_backlog'),
    priority: v.optional(v.number()),
    complexity: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
    value: v.optional(v.union(v.literal('low'), v.literal('medium'), v.literal('high'))),
  },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.itemId);
    if (!item) throw new ConvexError('Backlog item not found');
    await requireBacklogItemForChatroom(ctx, args.sessionId, args.chatroomId, item);
    await patchBacklogItemUseCase(ctx, {
      itemId: args.itemId,
      priority: args.priority,
      complexity: args.complexity,
      value: args.value,
    });
    return { success: true };
  },
});
