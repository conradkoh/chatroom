/**
 * Use Case: List Owned Chatrooms
 *
 * The chatrooms a user owns, and their ordering. Shared by the chatroom list queries so the
 * owner index and the activity order are defined once.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

/** All chatrooms owned by the user, in index order. */
export async function listOwnedChatrooms(ctx: QueryCtx, ownerId: Id<'users'>) {
  return ctx.db
    .query('chatroom_rooms')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .collect();
}

/**
 * Sorts chatrooms by last activity, most recent first. Falls back to creation time for chatrooms
 * that have no activity yet. Sorts in place and returns the same array.
 */
export function sortByLastActivity<T extends { lastActivityAt?: number; _creationTime: number }>(
  chatrooms: T[]
): T[] {
  return chatrooms.sort((a, b) => {
    const aTime = a.lastActivityAt ?? a._creationTime;
    const bTime = b.lastActivityAt ?? b._creationTime;
    return bTime - aTime;
  });
}
