import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

/**
 * Upserts the user's read cursor for a chatroom.
 * Returns false (and writes nothing) when `minIntervalMs` is set and the cursor was written
 * less than that long ago. Callers that clear unread state must do so only on true.
 */
export async function upsertReadCursor(
  ctx: MutationCtx,
  a: {
    chatroomId: Id<'chatroom_rooms'>;
    userId: Id<'users'>;
    now: number;
    minIntervalMs?: number;
  }
): Promise<boolean> {
  const existing = await ctx.db
    .query('chatroom_read_cursors')
    .withIndex('by_userId_chatroomId', (q) =>
      q.eq('userId', a.userId).eq('chatroomId', a.chatroomId)
    )
    .first();

  if (existing) {
    if (a.minIntervalMs !== undefined && a.now - existing.lastSeenAt < a.minIntervalMs) {
      return false;
    }
    await ctx.db.patch('chatroom_read_cursors', existing._id, {
      lastSeenAt: a.now,
      updatedAt: a.now,
    });
    return true;
  }

  await ctx.db.insert('chatroom_read_cursors', {
    chatroomId: a.chatroomId,
    userId: a.userId,
    lastSeenAt: a.now,
    updatedAt: a.now,
  });
  return true;
}
