import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export const ENHANCER_ROLE = 'enhancer';

/** Inserts a planner→enhancer draft message visible only in the ALL tab. */
export async function insertPlannerToEnhancerDraftMessage(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    content: string;
    jobId: Id<'chatroom_enhancerJobs'>;
    attachedArtifactIds?: Id<'chatroom_artifacts'>[];
  }
): Promise<void> {
  const now = Date.now();
  await ctx.db.insert('chatroom_messages', {
    chatroomId: args.chatroomId,
    senderRole: 'planner',
    targetRole: ENHANCER_ROLE,
    content: args.content,
    type: 'handoff',
    enhancerJobId: args.jobId,
    visibleInAllTabOnly: true,
    ...(args.attachedArtifactIds &&
      args.attachedArtifactIds.length > 0 && {
        attachedArtifactIds: args.attachedArtifactIds,
      }),
  });
  await ctx.db.patch('chatroom_rooms', args.chatroomId, {
    lastActivityAt: now,
  });
}
