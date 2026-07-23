import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';
import { agentHarnessValidator } from '../../schema';
import { mutation } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { applyEnhancerComplete } from './completeLogic';
import {
  resolveWorkspaceForEnhancer,
  resolveHandoffTemplateSnapshot,
  computeEnhancerBackoffMs,
  emitEnhancerEvent,
} from './internal';
import { ENHANCER_MAX_ATTEMPTS } from '../../../config/reliability';

export const upsertConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    enabled: v.boolean(),
    targetId: v.literal('handoff:planner-to-builder'),
    agentHarness: agentHarnessValidator,
    model: v.string(),
    machineId: v.string(),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!args.model.trim()) {
      throw new ConvexError({ code: 'INVALID_MODEL', message: 'model must not be empty' });
    }
    if (!args.machineId.trim()) {
      throw new ConvexError({ code: 'INVALID_MACHINE', message: 'machineId must not be empty' });
    }

    const existing = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();

    const now = Date.now();
    const doc = {
      chatroomId: args.chatroomId,
      userId: session.userId,
      enabled: args.enabled,
      targetId: args.targetId,
      agentHarness: args.agentHarness,
      model: args.model.trim(),
      machineId: args.machineId.trim(),
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return { configId: existing._id };
    }
    const configId = await ctx.db.insert('chatroom_enhancerConfigs', doc);
    return { configId };
  },
});

export const disableConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const existing = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

export const enqueueHandoff = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    senderRole: v.string(),
    targetRole: v.string(),
    content: v.string(),
    attachedArtifactIds: v.optional(v.array(v.id('chatroom_artifacts'))),
  },
  handler: async (ctx, args) => {
    const { session, chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    if (
      args.senderRole.toLowerCase() !== 'planner' ||
      args.targetRole.toLowerCase() !== 'builder'
    ) {
      throw new ConvexError({
        code: 'NOT_APPLICABLE',
        message: 'Enhancer not applicable for this handoff',
      });
    }

    const config = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!config?.enabled || config.targetId !== 'handoff:planner-to-builder') {
      throw new ConvexError({ code: 'ENHANCER_NOT_ENABLED', message: 'Enhancer not enabled' });
    }

    const workspace = await resolveWorkspaceForEnhancer(ctx, args.chatroomId, config.machineId);
    const templateSnapshot = resolveHandoffTemplateSnapshot(chatroom, args.chatroomId);
    const now = Date.now();

    const jobId = await ctx.db.insert('chatroom_enhancerJobs', {
      chatroomId: args.chatroomId,
      userId: session.userId,
      targetId: 'handoff:planner-to-builder',
      fromRole: 'planner',
      toRole: 'builder',
      status: 'pending',
      draftContent: args.content,
      templateSnapshot,
      agentHarness: config.agentHarness,
      model: config.model,
      machineId: config.machineId,
      workingDir: workspace.workingDir,
      attemptCount: 1,
      maxAttempts: ENHANCER_MAX_ATTEMPTS,
      createdAt: now,
      pendingHandoffArgs: {
        senderRole: args.senderRole,
        targetRole: args.targetRole,
        attachedArtifactIds: args.attachedArtifactIds,
      },
    });

    await emitEnhancerEvent(
      ctx,
      {
        type: 'enhancer.job.created' as const,
        chatroomId: args.chatroomId,
        jobId,
        userId: session.userId,
        attemptCount: 1,
        maxAttempts: ENHANCER_MAX_ATTEMPTS,
      },
      now
    );

    return { jobId };
  },
});

export const recordAttemptFailure = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not found' });
    }
    if (job.status !== 'running') {
      return { terminal: true, status: job.status };
    }

    const now = Date.now();
    const attemptCount = job.attemptCount;
    if (attemptCount >= job.maxAttempts) {
      await ctx.db.patch(args.jobId, {
        status: 'failed',
        lastError: args.error,
        completedAt: now,
        runningSince: undefined,
      });
      await emitEnhancerEvent(
        ctx,
        {
          type: 'enhancer.job.failed' as const,
          chatroomId: args.chatroomId,
          jobId: args.jobId,
          attemptCount,
          error: args.error,
        },
        now
      );
      return { terminal: true, status: 'failed' as const };
    }

    const nextRetryAt = now + computeEnhancerBackoffMs(attemptCount);
    await ctx.db.patch(args.jobId, {
      status: 'pending',
      attemptCount: attemptCount + 1,
      lastError: args.error,
      nextRetryAt,
      runningSince: undefined,
    });
    await emitEnhancerEvent(
      ctx,
      {
        type: 'enhancer.attempt.failed' as const,
        chatroomId: args.chatroomId,
        jobId: args.jobId,
        attemptCount,
        error: args.error,
        nextRetryAt,
      },
      now
    );

    return { terminal: false, status: 'pending' as const, nextRetryAt };
  },
});

export const complete = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
    enhancedContent: v.string(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not found' });
    }

    const applied = await applyEnhancerComplete(ctx, {
      jobId: args.jobId,
      enhancedContent: args.enhancedContent,
      sessionId: args.sessionId,
    });
    if (!applied.ok) {
      const code =
        applied.reason === 'empty_content'
          ? 'INVALID_CONTENT'
          : applied.reason === 'invalid_status'
            ? 'INVALID_STATUS'
            : applied.reason === 'handoff_failed'
              ? 'HANDOFF_FAILED'
              : 'NOT_FOUND';
      throw new ConvexError({ code, message: applied.message });
    }

    return { success: true as const };
  },
});
