import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { deliverPendingHandoffFromJob } from './delivery';
import { emitEnhancerEvent } from './internal';
import { assertEnhancerJobOwner } from './jobHelpers';
import { buildPlanningReviewOutcomeContent } from '../../../src/domain/usecase/enhancer/build-planning-review-outcome';
import { mutation } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const cancelActiveJob = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not found' });
    }
    assertEnhancerJobOwner(job, session.userId);
    if (job.status !== 'pending' && job.status !== 'running') {
      throw new ConvexError({ code: 'INVALID_STATUS', message: 'Job is not active' });
    }
    const handoffResult = await deliverPendingHandoffFromJob(ctx, {
      sessionId: args.sessionId,
      job,
      content: buildPlanningReviewOutcomeContent('cancelled', 'cancelled_by_user'),
    });
    if (!handoffResult.success) {
      throw new ConvexError({
        code: 'HANDOFF_FAILED',
        message: handoffResult.error?.message ?? 'Failed to deliver planning review outcome',
      });
    }

    const now = Date.now();
    await ctx.db.patch('chatroom_enhancerJobs', args.jobId, {
      status: 'cancelled',
      lastError: 'cancelled_by_user',
      completedAt: now,
      runningSince: undefined,
    });

    await emitEnhancerEvent(
      ctx,
      {
        type: 'enhancer.job.cancelled' as const,
        chatroomId: args.chatroomId,
        jobId: args.jobId,
        attemptCount: job.attemptCount,
      },
      now
    );

    return { success: true as const };
  },
});
