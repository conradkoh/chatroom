/**
 * delete-backlog-item usecase
 *
 * Permanently hard-deletes a backlog item from any status. NOT an FSM
 * transition and NOT a new `deleted` status — the row is removed and cannot be
 * reopened. Before deleting, any `attachedBacklogItemIds` references on
 * `chatroom_messages` and `chatroom_messageQueue` in the same chatroom are
 * scrubbed so they do not dangle.
 *
 * Expects a pre-fetched item to avoid redundant DB reads (the Convex handler
 * already fetches the item for access control).
 */
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function deleteBacklogItem(
  ctx: MutationCtx,
  item: Doc<'chatroom_backlog'>
): Promise<void> {
  await scrubAttachedBacklogRefs(ctx, item.chatroomId, item._id);
  await ctx.db.delete('chatroom_backlog', item._id);
}

async function scrubAttachedBacklogRefs(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  await scrubMessages(ctx, chatroomId, itemId);
  await scrubQueuedMessages(ctx, chatroomId, itemId);
}

async function scrubMessages(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  const messages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  for (const msg of messages) {
    if (msg.attachedBacklogItemIds && msg.attachedBacklogItemIds.includes(itemId)) {
      await ctx.db.patch('chatroom_messages', msg._id, {
        attachedBacklogItemIds: withoutItemId(msg.attachedBacklogItemIds, itemId),
      });
    }
  }
}

async function scrubQueuedMessages(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  const queued = await ctx.db
    .query('chatroom_messageQueue')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  for (const q of queued) {
    if (q.attachedBacklogItemIds && q.attachedBacklogItemIds.includes(itemId)) {
      await ctx.db.patch('chatroom_messageQueue', q._id, {
        attachedBacklogItemIds: withoutItemId(q.attachedBacklogItemIds, itemId),
      });
    }
  }
}

/**
 * Remove an item id from an attachment array. Returns `undefined` when the
 * array becomes empty so the optional field is dropped from the document.
 */
function withoutItemId(
  ids: Id<'chatroom_backlog'>[],
  itemId: Id<'chatroom_backlog'>
): Id<'chatroom_backlog'>[] | undefined {
  const filtered = ids.filter((id) => id !== itemId);
  return filtered.length > 0 ? filtered : undefined;
}
