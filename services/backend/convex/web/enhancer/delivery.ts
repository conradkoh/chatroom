import type { Doc } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { performHandoffFromEnhancer } from '../../messages';

export async function deliverPendingHandoffFromJob(
  ctx: MutationCtx,
  params: {
    sessionId: string;
    job: Doc<'chatroom_enhancerJobs'>;
    content: string;
  }
) {
  const handoffArgs = params.job.pendingHandoffArgs;
  if (!handoffArgs) {
    return { success: false as const, error: { message: 'Job missing pendingHandoffArgs' } };
  }
  return performHandoffFromEnhancer(ctx, {
    sessionId: params.sessionId,
    chatroomId: params.job.chatroomId,
    senderRole: handoffArgs.senderRole,
    targetRole: handoffArgs.targetRole,
    content: params.content,
    attachedArtifactIds: handoffArgs.attachedArtifactIds,
    jobId: params.job._id,
  });
}
