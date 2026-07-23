import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { query } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const getActiveJob = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const [pending, running] = await Promise.all([
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'pending')
        )
        .collect(),
      ctx.db
        .query('chatroom_enhancerJobs')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', args.chatroomId).eq('status', 'running')
        )
        .collect(),
    ]);
    const active = [...pending, ...running].find(
      (j) => j.fromRole === 'planner' && j.toRole === 'builder'
    );
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

export const getConfig = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const config = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!config) return null;
    return {
      enabled: config.enabled,
      targetId: config.targetId,
      agentHarness: config.agentHarness,
      model: config.model,
      machineId: config.machineId,
      updatedAt: config.updatedAt,
    };
  },
});

export const getJob = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) return null;
    return {
      status: job.status,
      attemptCount: job.attemptCount,
      maxAttempts: job.maxAttempts,
      lastError: job.lastError,
      runningSince: job.runningSince,
      nextRetryAt: job.nextRetryAt,
      completedAt: job.completedAt,
      draftContent: job.draftContent,
      enhancedContent: job.enhancedContent,
    };
  },
});
