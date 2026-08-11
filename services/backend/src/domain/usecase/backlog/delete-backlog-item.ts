/**
 * delete-backlog-item usecase
 *
 * Soft-deletes a backlog item from any status. The row is retained so existing
 * message attachment references remain valid, but deleted items are excluded
 * from normal backlog status queries and cannot be reopened.
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
  await ctx.db.patch('chatroom_backlog', item._id, {
    status: 'deleted',
    updatedAt: Date.now(),
  });
}
