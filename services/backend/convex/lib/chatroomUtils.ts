/**
 * Chatroom utility helpers — non-auth chatroom state queries and mutations.
 *
 * These utilities operate on chatroom state but are NOT authentication helpers.
 * They were previously co-located with auth helpers in cliSessionAuth.ts.
 */

import { isActiveParticipant } from '../../src/domain/entities/participant';
import { getTeamEntryPoint } from '../../src/domain/entities/team';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';

/** Returns true if all active participants in the chatroom are in the get-next-task wait loop. */
export async function areAllAgentsWaiting(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const participants = await ctx.db
    .query('chatroom_participants')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const activeParticipants = participants.filter(isActiveParticipant);
  if (activeParticipants.length === 0) return false;

  return activeParticipants.every((p) => p.lastSeenAction === 'get-next-task:started');
}

/** Returns the entry point role for a chatroom. */
export function getEntryPointRole(chatroom: Doc<'chatroom_rooms'>): string | null {
  return getTeamEntryPoint(chatroom);
}

/** Atomically retrieves and increments the next queue position for a chatroom. */
export async function getAndIncrementQueuePosition(
  ctx: MutationCtx,
  chatroom: Doc<'chatroom_rooms'>
): Promise<number> {
  const currentPosition = chatroom.nextQueuePosition;

  if (currentPosition === undefined) {
    // Migration path: initialize from max existing task position
    // Use by_chatroom_queue index with desc order to find the highest position efficiently
    const lastTask = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroom._id))
      .order('desc')
      .first();
    const maxPosition = lastTask ? lastTask.queuePosition : 0;
    const nextPosition = maxPosition + 1;

    // Initialize the counter (next task will get nextPosition + 1)
    await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: nextPosition + 1 });

    return nextPosition;
  }

  // Atomic increment: get current value and increment for next use
  await ctx.db.patch('chatroom_rooms', chatroom._id, { nextQueuePosition: currentPosition + 1 });

  return currentPosition;
}
