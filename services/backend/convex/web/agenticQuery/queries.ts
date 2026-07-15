import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { mutation, query } from '../../_generated/server';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

export const createDraft = mutation({
  args: {
    ...SessionIdArg,
    workspaceId: v.id('chatroom_workspaces'),
    mode: v.union(v.literal('search'), v.literal('ask')),
  },
  handler: async (ctx, args) => {
    const workspace = await ctx.db.get('chatroom_workspaces', args.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    const { session } = await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    const now = Date.now();
    const queryId = await ctx.db.insert('chatroom_agenticQueries', {
      workspaceId: args.workspaceId,
      status: 'draft',
      mode: args.mode,
      title: args.mode === 'search' ? 'Agentic Search' : 'Agentic Ask',
      createdBy: session.userId,
      createdAt: now,
      lastActiveAt: now,
    });

    return { queryId };
  },
});

export const get = query({
  args: {
    ...SessionIdArg,
    queryId: v.id('chatroom_agenticQueries'),
  },
  handler: async (ctx, args) => {
    const queryDoc = await ctx.db.get('chatroom_agenticQueries', args.queryId);
    if (!queryDoc) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Agentic query not found' });
    }

    const workspace = await ctx.db.get('chatroom_workspaces', queryDoc.workspaceId);
    if (!workspace) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
    }

    await requireChatroomAccess(ctx, args.sessionId, workspace.chatroomId);

    const turns = await ctx.db
      .query('chatroom_agenticQueryTurns')
      .withIndex('by_agenticQueryId', (q) => q.eq('agenticQueryId', args.queryId))
      .collect();

    turns.sort((a, b) => a.seq - b.seq);

    return {
      query: {
        _id: queryDoc._id,
        workspaceId: queryDoc.workspaceId,
        status: queryDoc.status,
        mode: queryDoc.mode,
        title: queryDoc.title,
        harnessSessionId: queryDoc.harnessSessionId,
        summary: queryDoc.summary,
        createdAt: queryDoc.createdAt,
        lastActiveAt: queryDoc.lastActiveAt,
      },
      turns: turns.map((t) => ({
        _id: t._id,
        seq: t.seq,
        userMessage: t.userMessage,
        assistantResponse: t.assistantResponse,
        structuredResult: t.structuredResult,
        createdAt: t.createdAt,
      })),
    };
  },
});
