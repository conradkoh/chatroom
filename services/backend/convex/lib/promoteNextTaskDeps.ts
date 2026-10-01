/**
 * Centralized dependency factory for promoteNextTask.
 *
 * Wires the standard Convex mutation context into the PromoteNextTaskDeps
 * interface. All callers should use this factory instead of duplicating
 * the dep wiring inline.
 */

import type { PromoteNextTaskDeps } from '../../src/domain/usecase/task/promote-next-task';
import { promoteQueuedMessage } from '../../src/domain/usecase/task/promote-queued-message';
import { hasActiveTaskFromSource } from '../../src/domain/usecase/task/task-counts';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

/**
 * Checks that no tasks with an active status (pending, acknowledged, in_progress)
 * exist in the chatroom — the authoritative guard against premature promotion.
 */
export async function canPromote(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  return !(await hasActiveTaskFromSource(ctx, chatroomId));
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
