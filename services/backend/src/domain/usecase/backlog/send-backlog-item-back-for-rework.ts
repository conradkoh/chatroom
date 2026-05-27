/**
 * send-backlog-item-back-for-rework usecase
 *
 * User sends a pending_user_review item back to backlog for more work.
 * Delegates to FSM trigger 'sendBacklogItemBackForRework'.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function sendBacklogItemBackForRework(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  await transitionBacklogItem(ctx, itemId, 'backlog', 'sendBacklogItemBackForRework');
}
