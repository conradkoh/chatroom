/**
 * Shared helpers for machine assigned-task queries.
 */

import type { AssignedTask } from './assigned-tasks-types';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type CollectCtx = QueryCtx | MutationCtx;

export async function getParticipantForChatroomRole(
  ctx: CollectCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<Doc<'chatroom_participants'> | null> {
  return (
    (await ctx.db
      .query('chatroom_participants')
      .withIndex('by_chatroom_and_role', (q) => q.eq('chatroomId', chatroomId).eq('role', role))
      .unique()) ?? null
  );
}

export function toParticipantView(
  participant: Doc<'chatroom_participants'> | null
): AssignedTask['participant'] {
  if (!participant) {
    return {
      lastSeenAction: null,
      lastSeenAt: null,
    };
  }
  return {
    lastSeenAction: participant.lastSeenAction ?? null,
    lastSeenAt: participant.lastSeenAt ?? null,
  };
}
