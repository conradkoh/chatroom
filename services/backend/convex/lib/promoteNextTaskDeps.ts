/**
 * Centralized dependency factory for promoteNextTask.
 *
 * Wires the standard Convex mutation context into the PromoteNextTaskDeps
 * interface. All callers should use this factory instead of duplicating
 * the dep wiring inline.
 */

import type { MutationCtx } from '../_generated/server';
import type { PromoteNextTaskDeps } from '../../src/domain/usecase/task/promote-next-task';
import { promoteQueuedMessage } from '../../src/domain/usecase/task/promote-queued-message';

/**
 * Creates PromoteNextTaskDeps wired to the given Convex mutation context.
 *
 * `canPromote` checks that no tasks with an active status (pending,
 * acknowledged, in_progress) exist in the chatroom — this is the
 * authoritative guard against premature promotion.
 */
export function makePromoteNextTaskDeps(ctx: MutationCtx): PromoteNextTaskDeps {
  return {
    canPromote: async (chatroomId) => {
      // Check each active status with short-circuit — stop as soon as one is found.
      for (const status of ['pending', 'acknowledged', 'in_progress'] as const) {
        const task = await ctx.db
          .query('chatroom_tasks')
          .withIndex('by_chatroom_status', (q) =>
            q.eq('chatroomId', chatroomId).eq('status', status)
          )
          .first();
        if (task) return false;
      }
      return true;
    },
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
