import { getTeamPreset } from '@workspace/shared/domain/team-presets';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { applyEnhancerComplete } from './completeLogic';
import { deliverPendingHandoffFromJob } from './delivery';
import { enqueueHandoff } from './enqueueHandoff';
import { computeEnhancerBackoffMs, emitEnhancerEvent } from './internal';
import { assertEnhancerJobOwner } from './jobHelpers';
import { buildPlanningReviewOutcomeContent } from '../../../src/domain/usecase/enhancer/build-planning-review-outcome';
import { transitionEnhancerEntryPointToWaiting } from '../../../src/domain/usecase/enhancer/enhancer-entry-point-status';
import {
  getEnhancerTeamAgentConfig,
  hasRemoteEnhancerConfigFields,
  syncEnhancerTeamAgentConfig,
} from '../../../src/domain/usecase/enhancer/get-enhancer-team-agent-config';
import { mutation } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';
import { agentHarnessValidator } from '../../schema';

export { enqueueHandoff };

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
    const { session, chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!chatroom.teamId || !getTeamPreset(chatroom.teamId)) {
      throw new ConvexError({
        code: 'INVALID_TEAM',
        message: 'Enhancer configuration requires a Solo or Duo team',
      });
    }
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

    let configId;
    if (existing) {
      await ctx.db.patch('chatroom_enhancerConfigs', existing._id, doc);
      configId = existing._id;
    } else {
      configId = await ctx.db.insert('chatroom_enhancerConfigs', doc);
    }
    const legacyConfig = await ctx.db.get('chatroom_enhancerConfigs', configId);
    if (!legacyConfig) {
      throw new ConvexError({
        code: 'CONFIG_SYNC_FAILED',
        message: 'Failed to synchronize enhancer configuration',
      });
    }
    await syncEnhancerTeamAgentConfig(ctx, {
      chatroomId: args.chatroomId,
      teamId: chatroom.teamId,
      legacyConfig,
    });
    return { configId };
  },
});

// fallow-ignore-next-line code-duplication
export const disableConfig = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    const { session, chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const existing = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', session.userId)
      )
      .unique();
    if (!existing) return { disabled: false as const };
    await ctx.db.patch('chatroom_enhancerConfigs', existing._id, {
      enabled: false,
      updatedAt: Date.now(),
    });
    if (chatroom.teamId) {
      const teamConfig = await getEnhancerTeamAgentConfig(ctx, args.chatroomId, chatroom.teamId);
      if (teamConfig)
        await ctx.db.patch('chatroom_teamAgentConfigs', teamConfig._id, { enabled: false });
    }
    return { disabled: true as const };
  },
});

export const setEnhancerEnabled = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    enabled: v.boolean(),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const { chatroom } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!chatroom.teamId || !getTeamPreset(chatroom.teamId)) {
      throw new ConvexError({
        code: 'INVALID_TEAM',
        message: 'Enhancer configuration requires a Solo or Duo team',
      });
    }

    const row = await getEnhancerTeamAgentConfig(ctx, args.chatroomId, chatroom.teamId);

    if (args.enabled && !hasRemoteEnhancerConfigFields(row)) {
      throw new ConvexError({
        code: 'ENHANCER_CONFIG_INCOMPLETE',
        message:
          'Configure machine, harness, model, and working directory before enabling the enhancer',
      });
    }

    if (!row) {
      return { success: true, enabled: false };
    }

    await ctx.db.patch('chatroom_teamAgentConfigs', row._id, {
      enabled: args.enabled,
      updatedAt: Date.now(),
    });
    return { success: true, enabled: args.enabled };
  },
});

export const recordAttemptFailure = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
    error: v.string(),
    forceTerminal: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not found' });
    }
    assertEnhancerJobOwner(job, session.userId);
    if (job.status !== 'running') {
      return { terminal: true, status: job.status };
    }

    const now = Date.now();
    const attemptCount = job.attemptCount;
    if (args.forceTerminal || attemptCount >= job.maxAttempts) {
      // Terminal failure: deliver planning-review-outcome envelope before marking failed
      let error = args.error;
      const handoffResult = await deliverPendingHandoffFromJob(ctx, {
        sessionId: args.sessionId,
        job,
        content: buildPlanningReviewOutcomeContent('failed', error),
      });
      if (!handoffResult.success) {
        error = `${error}; draft handoff delivery failed: ${handoffResult.error?.message}`;
      }

      await ctx.db.patch('chatroom_enhancerJobs', args.jobId, {
        status: 'failed',
        lastError: error,
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
          error,
        },
        now
      );
      await transitionEnhancerEntryPointToWaiting(ctx, args.chatroomId, job.fromRole);
      return { terminal: true, status: 'failed' as const };
    }

    const nextRetryAt = now + computeEnhancerBackoffMs(attemptCount);
    await ctx.db.patch('chatroom_enhancerJobs', args.jobId, {
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

/** @deprecated Use enhancer `chatroom handoff` delivery. Retained for daemon salvage only. */
export const complete = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    jobId: v.id('chatroom_enhancerJobs'),
    enhancedContent: v.string(),
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
    if (!job || job.chatroomId !== args.chatroomId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Enhancer job not found' });
    }
    assertEnhancerJobOwner(job, session.userId);

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
