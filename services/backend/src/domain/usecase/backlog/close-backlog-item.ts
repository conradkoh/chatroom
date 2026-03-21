/**
 * close-backlog-item usecase
 *
 * Closes a backlog item regardless of its current active status.
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
  await transitionBacklogItem(ctx, itemId, 'closed', 'closeBacklogItem', {
    closeReason: options.reason,
  });
}
