import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { performHandoffFromEnhancer } from '../../messages';
import { emitEnhancerEvent } from './internal';

export interface ApplyEnhancerCompleteParams {
  jobId: Id<'chatroom_enhancerJobs'>;
  enhancedContent: string;
  sessionId: string;
}

export type ApplyEnhancerCompleteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_status' | 'empty_content' | 'handoff_failed';
      message: string;
    };

export async function applyEnhancerComplete(
  ctx: MutationCtx,
  params: ApplyEnhancerCompleteParams
): Promise<ApplyEnhancerCompleteResult> {
  const job = await ctx.db.get('chatroom_enhancerJobs', params.jobId);
  if (!job) {
    return { ok: false, reason: 'not_found', message: 'Enhancer job not found' };
  }
  if (job.status !== 'running') {
    return {
      ok: false,
      reason: 'invalid_status',
      message: `Job must be running to complete (current: ${job.status})`,
    };
  }
  const enhancedContent = params.enhancedContent.trim();
  if (!enhancedContent) {
    return { ok: false, reason: 'empty_content', message: 'Enhanced content must not be empty' };
  }

  const handoffArgs = job.pendingHandoffArgs;
  if (!handoffArgs) {
    return { ok: false, reason: 'invalid_status', message: 'Job missing pendingHandoffArgs' };
  }

  const handoffResult = await performHandoffFromEnhancer(ctx, {
    sessionId: params.sessionId,
    chatroomId: job.chatroomId,
    senderRole: handoffArgs.senderRole,
    targetRole: handoffArgs.targetRole,
    content: enhancedContent,
    attachedArtifactIds: handoffArgs.attachedArtifactIds,
    jobId: params.jobId,
  });

  if (!handoffResult.success) {
    return {
      ok: false,
      reason: 'handoff_failed',
      message: handoffResult.error?.message ?? 'Handoff failed',
    };
  }

  const now = Date.now();
  await ctx.db.patch('chatroom_enhancerJobs', params.jobId, {
    status: 'complete',
    enhancedContent,
    completedAt: now,
  });

  await emitEnhancerEvent(
    ctx,
    {
      type: 'enhancer.job.complete' as const,
      chatroomId: job.chatroomId,
      jobId: params.jobId,
      attemptCount: job.attemptCount,
    },
    now
  );

  return { ok: true };
}
