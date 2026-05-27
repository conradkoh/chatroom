/**
 * mark-backlog-item-for-review usecase
 *
 * Agent signals a backlog item is done and needs user review.
 * Item must be in backlog status. Delegates to FSM trigger 'markBacklogItemForReview'.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function markBacklogItemForReview(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  await transitionBacklogItem(ctx, itemId, 'pending_user_review', 'markBacklogItemForReview');
}
