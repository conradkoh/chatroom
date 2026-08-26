import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

export async function findEnhancerTaskForOrigin(
  ctx: QueryCtx | MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; originUserMessageId: Id<'chatroom_messages'> }
): Promise<Doc<'chatroom_tasks'> | null> {
  return ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom_assignedTo_originUserMessageId', (q) =>
      q
        .eq('chatroomId', args.chatroomId)
        .eq('assignedTo', 'enhancer')
        .eq('originUserMessageId', args.originUserMessageId)
    )
    .first();
}
