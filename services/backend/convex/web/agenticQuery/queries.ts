import { mutation } from '../../_generated/server';
import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

export const createDraft = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    mode: v.union(v.literal('search'), v.literal('ask')),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error('Not authenticated');

    const workspace = await ctx.db.get(args.workspaceId);
    if (!workspace) throw new Error('Workspace not found');

    const now = Date.now();
    const queryId = await ctx.db.insert('chatroom_agenticQueries', {
      workspaceId: args.workspaceId,
      status: 'draft',
      mode: args.mode,
      title: args.mode === 'search' ? 'Agentic Search' : 'Agentic Ask',
      createdBy: identity.subject as any,
      createdAt: now,
      lastActiveAt: now,
    });

    return { queryId };
  },
});
