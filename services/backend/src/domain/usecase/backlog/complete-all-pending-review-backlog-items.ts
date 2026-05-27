/**
 * complete-all-pending-review-backlog-items usecase
 *
 * User confirms all pending review items are done. Bulk-completes every
 * backlog item in pending_user_review status for the given chatroom.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function completeAllPendingReviewBacklogItems(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<number> {
  const items = await ctx.db
    .query('chatroom_backlog')
    .withIndex('by_chatroom_status', (q: any) =>
      q.eq('chatroomId', chatroomId).eq('status', 'pending_user_review')
    )
    .collect();

  let completed = 0;
  for (const item of items) {
    await transitionBacklogItem(ctx, item._id, 'closed', 'completeBacklogItem');
    completed++;
  }

  return completed;
}
