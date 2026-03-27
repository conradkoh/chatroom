/**
 * close-backlog-item usecase
 *
 * Closes a backlog item regardless of its current active status.
 * Idempotent: if the item is already closed, the operation is a no-op.
 * Delegates to the FSM which validates the transition and applies field updates.
 * Requires a reason for audit trail.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function closeBacklogItem(
  ctx: MutationCtx,
  itemId: Id<'chatroom_backlog'>,
  options: { reason: string }
): Promise<void> {
  // Idempotent guard: if the item is already closed, skip the transition
  const item = await ctx.db.get('chatroom_backlog', itemId);
  if (!item) {
    throw new Error(`Backlog item ${itemId} not found`);
  }
  if (item.status === 'closed') {
    return;
  }

  await transitionBacklogItem(ctx, itemId, 'closed', 'closeBacklogItem', {
    closeReason: options.reason,
  });
}
