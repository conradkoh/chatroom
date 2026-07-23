import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface ApplyEnhancerCompleteParams {
  jobId: Id<'chatroom_enhancerJobs'>;
  enhancedContent: string;
}

export type ApplyEnhancerCompleteResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_status' | 'empty_content';
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

  const now = Date.now();
  await ctx.db.patch('chatroom_enhancerJobs', params.jobId, {
    status: 'complete',
    enhancedContent,
    completedAt: now,
  });

  return { ok: true };
}
