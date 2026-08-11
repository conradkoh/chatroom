import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { findActiveEnhancerJob } from './jobHelpers';
import type { Doc, Id } from '../../_generated/dataModel';
import { query } from '../../_generated/server';
import type { QueryCtx } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

async function getAuthorizedEnhancerJob(
  ctx: QueryCtx,
  sessionId: string,
  chatroomId: Id<'chatroom_rooms'>,
  jobId: Id<'chatroom_enhancerJobs'>
): Promise<Doc<'chatroom_enhancerJobs'> | null> {
  await requireChatroomAccess(ctx, sessionId, chatroomId);
  const job = await ctx.db.get('chatroom_enhancerJobs', jobId);
  return job && job.chatroomId === chatroomId ? job : null;
}

function toEnhancerJobState(job: Doc<'chatroom_enhancerJobs'>) {
  return {
    status: job.status,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    lastError: job.lastError,
    runningSince: job.runningSince,
    nextRetryAt: job.nextRetryAt,
    completedAt: job.completedAt,
  };
}

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
    const job = await getAuthorizedEnhancerJob(ctx, args.sessionId, args.chatroomId, args.jobId);
    if (!job) return null;
    return {
      ...toEnhancerJobState(job),
      draftContent: job.draftContent,
      enhancedContent: job.enhancedContent,
    };
  },
});

/**
 * Reactive lifecycle state for the daemon waiting on a single enhancer job.
 *
 * Keep this response separate from getJob: the daemon only needs lifecycle
 * state, while getJob also exposes the potentially large content fields.
 */
// fallow-ignore-next-line code-duplication
export const getJobOutcome = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
  },
  handler: async (ctx, args) => {
    const job = await getAuthorizedEnhancerJob(ctx, args.sessionId, args.chatroomId, args.jobId);
    if (!job) return null;
    return toEnhancerJobState(job);
  },
});
