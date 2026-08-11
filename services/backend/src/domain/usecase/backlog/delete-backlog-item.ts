/**
 * delete-backlog-item usecase
 *
 * Permanently hard-deletes a backlog item from any status. NOT an FSM
 * transition and NOT a new `deleted` status — the row is removed and cannot be
 * reopened. References on messages are scrubbed asynchronously by the
 * Convex handler in bounded batches before this use case is invoked.
 *
 * Expects a pre-fetched item to avoid redundant DB reads (the Convex handler
 * already fetches the item for access control).
 */
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function deleteBacklogItem(
  ctx: MutationCtx,
  item: Doc<'chatroom_backlog'>
): Promise<void> {
  await ctx.db.delete('chatroom_backlog', item._id);
}
