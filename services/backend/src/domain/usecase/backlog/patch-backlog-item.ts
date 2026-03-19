/**
 * patch-backlog-item usecase
 *
 * Updates priority, complexity, or value of a backlog item.
 * These metadata fields can be updated regardless of status
 * (unlike content which requires 'backlog' status).
 */
import { ConvexError } from 'convex/values';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface PatchBacklogItemArgs {
  itemId: Id<'chatroom_backlog'>;
  priority?: number;
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
}

export async function patchBacklogItem(
  ctx: MutationCtx,
  args: PatchBacklogItemArgs
): Promise<void> {
  const item = await ctx.db.get('chatroom_backlog', args.itemId);
  if (!item) throw new ConvexError('Backlog item not found');

  const updates: Record<string, unknown> = { updatedAt: Date.now() };
  if (args.priority !== undefined) updates.priority = args.priority;
  if (args.complexity !== undefined) updates.complexity = args.complexity;
  if (args.value !== undefined) updates.value = args.value;

  await ctx.db.patch('chatroom_backlog', args.itemId, updates);
}
