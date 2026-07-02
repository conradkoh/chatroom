import { hasActiveTaskFromMaterializedCounts } from './create-task';
import { countActiveTasksFromSource, type ActiveTaskCounts } from './task-counts';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';

type DbCtx = MutationCtx | QueryCtx;

export type ChatroomQueueState = {
  hasActiveTask: boolean;
  hasQueuedMessages: boolean;
  /** True when no active tasks and no queued messages remain. */
  isWorkQueueEmpty: boolean;
};

function hasActiveTaskFromCounts(counts: ActiveTaskCounts): boolean {
  return counts.pending > 0 || counts.acknowledged > 0 || counts.inProgress > 0;
}

/**
 * Single source of truth for chatroom work-queue occupancy.
 * Mirrors WorkQueue.tsx + getTaskCounts semantics.
 */
// fallow-ignore-next-line complexity
export async function getChatroomQueueState(
  ctx: DbCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<ChatroomQueueState> {
  const materializedCounts = await ctx.db
    .query('chatroom_taskCounts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();

  if (materializedCounts) {
    const hasActiveTask = hasActiveTaskFromMaterializedCounts(materializedCounts);

    const firstQueuedMessage = await ctx.db
      .query('chatroom_messageQueue')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .first();
    const actualHasQueued = firstQueuedMessage !== null;
    const queuedCount = actualHasQueued ? Math.max(materializedCounts.queueSize, 1) : 0;

    return {
      hasActiveTask,
      hasQueuedMessages: queuedCount > 0,
      isWorkQueueEmpty: !hasActiveTask && queuedCount === 0,
    };
  }

  // Fallback when materialized counts doc missing (migration safety)
  const activeCounts = await countActiveTasksFromSource(ctx, chatroomId);
  const hasActiveTask = hasActiveTaskFromCounts(activeCounts);

  const firstQueuedMessage = await ctx.db
    .query('chatroom_messageQueue')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();

  return {
    hasActiveTask,
    hasQueuedMessages: firstQueuedMessage !== null,
    isWorkQueueEmpty: !hasActiveTask && firstQueuedMessage === null,
  };
}
