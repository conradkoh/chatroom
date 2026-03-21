/**
 * update-backlog-item usecase
 *
 * Updates the content of a backlog item. Only allowed when status is 'backlog'.
 */
import { ConvexError } from 'convex/values';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { canEditBacklogContent } from '../../entities/backlog-item';

export interface UpdateBacklogItemArgs {
  itemId: Id<'chatroom_backlog'>;
  content: string;
}

export async function updateBacklogItem(
  ctx: MutationCtx,
  args: UpdateBacklogItemArgs
): Promise<void> {
  const item = await ctx.db.get('chatroom_backlog', args.itemId);
  if (!item) throw new ConvexError('Backlog item not found');

  if (!canEditBacklogContent(item.status)) {
    throw new ConvexError(`Cannot edit item with status: ${item.status}. Must be in backlog.`);
  }

  if (!args.content.trim()) {
    throw new ConvexError('Content cannot be empty');
  }

  await ctx.db.patch('chatroom_backlog', args.itemId, {
    content: args.content.trim(),
    updatedAt: Date.now(),
  });
}
