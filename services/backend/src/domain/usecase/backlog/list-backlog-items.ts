/**
 * list-backlog-items usecase
 *
 * Lists backlog items for a chatroom with optional status filtering and limit.
 */
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { ACTIVE_BACKLOG_STATUSES } from '../../entities/backlog-item';

export type BacklogStatusFilter = 'backlog' | 'pending_user_review' | 'closed' | 'active';

export interface ListBacklogItemsArgs {
  chatroomId: Id<'chatroom_rooms'>;
  statusFilter?: BacklogStatusFilter;
  limit?: number;
}

export async function listBacklogItems(ctx: QueryCtx, args: ListBacklogItemsArgs) {
  let items = await ctx.db
    .query('chatroom_backlog')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
    .collect();

  // Apply status filter
  if (args.statusFilter === 'backlog') {
    items = items.filter((i) => i.status === 'backlog');
  } else if (args.statusFilter === 'pending_user_review') {
    items = items.filter((i) => i.status === 'pending_user_review');
  } else if (args.statusFilter === 'closed') {
    items = items.filter((i) => i.status === 'closed');
  } else {
    // 'active' or no filter → show active items
    items = items.filter((i) => ACTIVE_BACKLOG_STATUSES.has(i.status as any));
  }

  // Sort by priority descending (higher first), then createdAt descending
  items.sort((a, b) => {
    const aPriority = a.priority ?? -Infinity;
    const bPriority = b.priority ?? -Infinity;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return b.createdAt - a.createdAt;
  });

  const limit = Math.min(args.limit ?? 100, 100);
  return items.slice(0, limit);
}
