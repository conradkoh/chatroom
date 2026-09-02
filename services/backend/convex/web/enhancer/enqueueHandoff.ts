import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../../_generated/server';
import { runHandoffHandler } from '../../messages';

/** @deprecated Prefer `messages.handoff` — kept for integration tests and backwards compatibility. */
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
    const result = await runHandoffHandler(ctx, {
      sessionId: args.sessionId,
      chatroomId: args.chatroomId,
      senderRole: args.senderRole,
      content: args.content,
      targetRole: args.targetRole,
      attachedArtifactIds: args.attachedArtifactIds,
    });

    if (!result.success) {
      throw new ConvexError({
        code: result.error?.code ?? 'HANDOFF_FAILED',
        message: result.error?.message ?? 'Handoff failed',
      });
    }

    const legacyJobId = (result as { enhancerJobId?: string | null | undefined }).enhancerJobId;
    if (!legacyJobId) {
      throw new ConvexError({
        code: 'HANDOFF_FAILED',
        message: 'Expected enhancer job from entry-point→enhancer handoff',
      });
    }

    return { jobId: legacyJobId };
  },
});
