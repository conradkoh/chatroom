import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { findActiveEnhancerJob } from './jobHelpers';
import { query } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const getActiveJob = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const active = await findActiveEnhancerJob(ctx, args.chatroomId, 'planner', 'enhancer');
    if (!active) return null;
    return {
      jobId: active._id,
      status: active.status,
      attemptCount: active.attemptCount,
      maxAttempts: active.maxAttempts,
      fromRole: active.fromRole,
      toRole: active.toRole,
    };
  },
});
