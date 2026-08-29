import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { emitEnhancerEvent } from '../../../../convex/web/enhancer/internal';

/** Terminal transition for a running enhancer job after design input is delivered. */
export async function completeEnhancerJob(
  ctx: MutationCtx,
  args: {
    jobId: Id<'chatroom_enhancerJobs'>;
    enhancedContent: string;
  }
): Promise<boolean> {
  const job = await ctx.db.get('chatroom_enhancerJobs', args.jobId);
  if (!job || job.status !== 'running') return false;

  const enhancedContent = args.enhancedContent.trim();
  const now = Date.now();
  await ctx.db.patch('chatroom_enhancerJobs', args.jobId, {
    status: 'complete',
    enhancedContent: enhancedContent || job.draftContent,
    completedAt: now,
  });

  await emitEnhancerEvent(
    ctx,
    {
      type: 'enhancer.job.complete' as const,
      chatroomId: job.chatroomId,
      jobId: args.jobId,
      attemptCount: job.attemptCount,
    },
    now
  );

  return true;
}
