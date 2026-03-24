/**
 * complete-backlog-item usecase
 *
 * User confirms work is done. Item can be in backlog or pending_user_review.
 * Delegates to FSM trigger 'completeBacklogItem'.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function completeBacklogItem(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  await transitionBacklogItem(ctx, itemId, 'closed', 'completeBacklogItem');
}
