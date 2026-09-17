import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { buildPlanningReviewOutcomeContent } from '../../../src/domain/usecase/enhancer/build-planning-review-outcome';
import { mutation, query } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { performHandoffFromEnhancer } from '../../messages';

const ENHANCER_IN_FLIGHT_STATUSES = ['pending', 'acknowledged', 'in_progress'] as const;

/** Webapp WorkQueue: the in-flight enhancer task replaces the retired job row. */
export const getActiveJob = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    for (const status of ENHANCER_IN_FLIGHT_STATUSES) {
      const task = await ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status_assignedTo', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', status).eq('assignedTo', 'enhancer')
        )
        .first();
      if (task) {
        return { taskId: task._id, status: task.status, fromRole: 'planner', toRole: 'enhancer' };
      }
    }
    return null;
  },
});

/**
 * Cancels in-flight enhancer work: delivers the planning-review-outcome
 * (cancelled) handoff to the team entry point, which completes the enhancer
 * task through the standard handoff flow.
 */
export const cancelActiveJob = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    taskId: v.id('chatroom_tasks'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const task = await ctx.db.get('chatroom_tasks', args.taskId);
    if (!task || task.chatroomId !== args.chatroomId || task.assignedTo !== 'enhancer') {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer task not found' });
    }
    if (!ENHANCER_IN_FLIGHT_STATUSES.includes(task.status as never)) {
      throw new ConvexError({ code: 'INVALID_STATUS', message: 'Task is not active' });
    }

    const targetRole = task.createdBy.toLowerCase();
    const handoffResult = await performHandoffFromEnhancer(ctx, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      targetRole,
      content: buildPlanningReviewOutcomeContent('cancelled', 'cancelled_by_user'),
    });
    if (!handoffResult.success) {
      throw new ConvexError({
        code: 'HANDOFF_FAILED',
        message: handoffResult.error?.message ?? 'Failed to deliver planning review outcome',
      });
    }

    return { success: true as const };
  },
});
