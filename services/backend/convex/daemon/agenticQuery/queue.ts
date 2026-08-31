import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation } from '../../_generated/server';
import { getRunWithAccess } from '../../api/agenticQueryHelpers';
import { requireSession } from '../../auth/session';

export const setGenerating = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    isGenerating: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireSession(ctx, args.sessionId);
    const run = await ctx.db.get('chatroom_agenticQueryRuns', args.runId);
    if (!run) return;
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      isGenerating: args.isGenerating,
    });
  },
});

export const dequeueNext = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    await getRunWithAccess(ctx, args.sessionId, args.runId);
    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      isGenerating: false,
    });
    return null;
  },
});
