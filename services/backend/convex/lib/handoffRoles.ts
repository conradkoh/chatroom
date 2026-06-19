import type { Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

export type UserMessageClassification = 'question' | 'new_feature' | 'follow_up' | null;

/** Latest classified user message via senderRole+type index (user 'message' rows only). */
export async function getLatestUserMessageClassification(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<UserMessageClassification> {
  const recentUserMessages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
      q.eq('chatroomId', chatroomId).eq('senderRole', 'user').eq('type', 'message')
    )
    .order('desc')
    .take(15);

  for (const msg of recentUserMessages) {
    if (msg.classification) {
      return msg.classification;
    }
  }
  return null;
}

/** Waiting participant roles plus user (always an allowed handoff target). */
export function buildAvailableHandoffRoles(waitingParticipantRoles: string[]): string[] {
  return [...waitingParticipantRoles, 'user'];
}
