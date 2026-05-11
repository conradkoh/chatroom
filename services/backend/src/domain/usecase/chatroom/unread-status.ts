/**
 * Unread Status Tracking
 *
 * Maintains per-user per-chatroom unread flags that are updated on write
 * (message insert, cursor update) instead of computed on read.
 *
 * This eliminates the N+1 message scan pattern in listUnreadStatus.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Mark a chatroom as having unread messages for its owner.
 * Called when a new displayable message is inserted.
 *
 * @param isHandoff - True if the message is a handoff-to-user message
 */
export async function markChatroomUnread(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  ownerId: string,
  isHandoff: boolean
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_unreadStatus')
    .withIndex('by_userId_chatroomId', (q: any) =>
      q.eq('userId', ownerId).eq('chatroomId', chatroomId)
    )
    .first();

  if (existing) {
    // Skip write if already in correct state (avoids unnecessary subscription invalidations)
    if (existing.hasUnread && (!isHandoff || existing.hasUnreadHandoff)) {
      return; // Already marked as unread with correct handoff state
    }
    const update: { hasUnread: boolean; hasUnreadHandoff?: boolean } = { hasUnread: true };
    if (isHandoff) {
      update.hasUnreadHandoff = true;
    }
    await ctx.db.patch("chatroom_unreadStatus", existing._id, update);
  } else {
    await ctx.db.insert('chatroom_unreadStatus', {
      chatroomId,
      userId: ownerId,
      hasUnread: true,
      hasUnreadHandoff: isHandoff,
    });
  }
}

/**
 * Clear unread status for a chatroom when the user marks it as read.
 */
export async function clearChatroomUnread(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  userId: string
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_unreadStatus')
    .withIndex('by_userId_chatroomId', (q: any) =>
      q.eq('userId', userId).eq('chatroomId', chatroomId)
    )
    .first();

  if (existing) {
    await ctx.db.patch("chatroom_unreadStatus", existing._id, {
      hasUnread: false,
      hasUnreadHandoff: false,
    });
  }
}
