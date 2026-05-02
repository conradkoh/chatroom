/**
 * create-backlog-item usecase
 *
 * Single entry point for creating a backlog item in a chatroom.
 */
import { ConvexError } from 'convex/values';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export interface CreateBacklogItemArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  priority?: number;
  complexity?: 'low' | 'medium' | 'high';
  value?: 'low' | 'medium' | 'high';
}

export interface CreateBacklogItemResult {
  itemId: Id<'chatroom_backlog'>;
}

export async function createBacklogItem(
  ctx: MutationCtx,
  args: CreateBacklogItemArgs
): Promise<CreateBacklogItemResult> {
  if (!args.content.trim()) {
    throw new ConvexError({ code: 'CONTENT_EMPTY', message: 'Content cannot be empty' });
  }

  const now = Date.now();
  const itemId = await ctx.db.insert('chatroom_backlog', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: args.content.trim(),
    status: 'backlog',
    createdAt: now,
    updatedAt: now,
    priority: args.priority,
    complexity: args.complexity,
    value: args.value,
  });

  return { itemId };
}
