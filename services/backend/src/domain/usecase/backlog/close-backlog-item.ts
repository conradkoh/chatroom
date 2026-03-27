/**
 * close-backlog-item usecase
 *
 * Closes a backlog item regardless of its current active status.
 * Idempotent: if the item is already closed, the operation is a no-op.
 * Delegates to the FSM which validates the transition and applies field updates.
 * Requires a reason for audit trail.
 *
 * Expects a pre-fetched item to avoid redundant DB reads (the Convex handler
 * already fetches the item for access control).
 */
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionBacklogItem } from '../../../../convex/lib/backlogStateMachine';

export async function closeBacklogItem(
  ctx: MutationCtx,
  item: Doc<'chatroom_backlog'>,
  options: { reason: string }
): Promise<void> {
  // Idempotent guard: if the item is already closed, skip the transition
  if (item.status === 'closed') {
    return;
  }

  await transitionBacklogItem(ctx, item._id, 'closed', 'closeBacklogItem', {
    closeReason: options.reason,
  });
}
