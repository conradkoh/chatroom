/**
 * Centralized dependency factory for promoteNextTask.
 *
 * Wires the standard Convex mutation context into the PromoteNextTaskDeps
 * interface. All callers should use this factory instead of duplicating
 * the dep wiring inline.
 */

import type { PromoteNextTaskDeps } from '../../src/domain/usecase/task/promote-next-task';
import { promoteQueuedMessage } from '../../src/domain/usecase/task/promote-queued-message';
import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';

/**
 * Checks that no tasks with an active status (pending, acknowledged, in_progress)
 * exist in the chatroom — the authoritative guard against premature promotion.
 */
export async function canPromote(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  for (const status of ['pending', 'acknowledged', 'in_progress'] as const) {
    const task = await ctx.db
      .query('chatroom_tasks')
      .withIndex('by_chatroom_status', (q) => q.eq('chatroomId', chatroomId).eq('status', status))
      .first();
    if (task) return false;
  }
  return true;
}

/**
 * Creates PromoteNextTaskDeps wired to the given Convex mutation context.
 */
export function makePromoteNextTaskDeps(ctx: MutationCtx): PromoteNextTaskDeps {
  return {
    canPromote: (chatroomId) => canPromote(ctx, chatroomId),
    getOldestQueuedMessage: async (chatroomId) => {
      return await ctx.db
        .query('chatroom_messageQueue')
        .withIndex('by_chatroom_queue', (q) => q.eq('chatroomId', chatroomId))
        .order('asc')
        .first();
    },
    promoteQueuedMessage: (queuedMessageId) => promoteQueuedMessage(ctx, queuedMessageId),
  };
}
