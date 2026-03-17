/**
 * reopen-backlog-item usecase
 *
 * Reopens a closed backlog item back to backlog status.
 * Delegates to FSM trigger 'reopenBacklogItem'.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function reopenBacklogItem(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>
): Promise<void> {
  await transitionBacklogItem(ctx, itemId, 'backlog', 'reopenBacklogItem');
}
