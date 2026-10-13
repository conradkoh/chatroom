/**
 * Use Case: List Chatroom Participants
 *
 * The participants of one chatroom, read through the by_chatroom index.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function listChatroomParticipants(ctx: QueryCtx, chatroomId: Id<'chatroom_rooms'>) {
  return ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
}
