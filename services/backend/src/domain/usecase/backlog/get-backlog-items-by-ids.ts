/**
 * get-backlog-items-by-ids usecase
 *
 * Fetches multiple backlog items by their IDs.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function getBacklogItemsByIds(
  ctx: QueryCtx,
  itemIds: Id<'chatroom_backlog'>[]
) {
  if (itemIds.length === 0) return [];
  const items = await Promise.all(itemIds.map((id) => ctx.db.get('chatroom_backlog', id)));
  return items.filter((i): i is NonNullable<typeof i> => i !== null);
}
