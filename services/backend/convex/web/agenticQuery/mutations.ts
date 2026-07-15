import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import {
  getAgenticQueryTurns,
  getNextAgenticTurnSeq,
  spawnAgenticHarnessSession,
} from './internal';
import { validateAgenticQueryCompleteResult } from '../../../prompts/agentic-query/validate-complete-result';
import type { Id } from '../../_generated/dataModel';
import { mutation } from '../../_generated/server';
import type { MutationCtx } from '../../_generated/server';
import { requireDirectHarnessWorkers } from '../../api/directHarnessHelpers';
import { requireChatroomAccess } from '../../auth/chatroomAccess';

async function loadQueryWithAccess(
  ctx: MutationCtx,
  sessionId: string,
  queryId: Id<'chatroom_agenticQueries'>
) {
  const query = await ctx.db.get('chatroom_agenticQueries', queryId);
  if (!query) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Agentic query not found' });
  }
  const workspace = await ctx.db.get('chatroom_workspaces', query.workspaceId);
  if (!workspace) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  }
  const { session } = await requireChatroomAccess(ctx, sessionId, workspace.chatroomId);
  return { query, workspace, session, chatroomId: workspace.chatroomId };
}

// fallow-ignore-next-line complexity
async function submitAgenticMessage(
  ctx: MutationCtx,
  args: { sessionId: string; queryId: Id<'chatroom_agenticQueries'>; message: string },
  allowStatuses: ('draft' | 'complete' | 'failed')[]
) {
  requireDirectHarnessWorkers();

  const message = args.message.trim();
  if (!message) {
    throw new ConvexError({ code: 'INVALID_MESSAGE', message: 'Message must not be empty' });
  }

  const { query, workspace, session, chatroomId } = await loadQueryWithAccess(
    ctx,
    args.sessionId,
    args.queryId
  );

  if (!allowStatuses.includes(query.status as (typeof allowStatuses)[number])) {
    throw new ConvexError({
      code: 'INVALID_STATUS',
      message: `Cannot submit while query status is ${query.status}`,
    });
  }

  const priorTurns = await getAgenticQueryTurns(ctx, args.queryId);
  const seq = await getNextAgenticTurnSeq(ctx, args.queryId);
  const now = Date.now();
  const title = message.split('\n')[0]?.slice(0, 80) || query.title;

  await ctx.db.insert('chatroom_agenticQueryTurns', {
    agenticQueryId: args.queryId,
    seq,
    userMessage: message,
    createdAt: now,
  });

  const harnessSessionId = await spawnAgenticHarnessSession(ctx, {
    query: { ...query, title },
    workspace,
    chatroomId,
    userId: session.userId,
    userMessage: message,
    priorTurns: priorTurns
      .filter((t) => t.assistantResponse)
      .map((t) => ({
        seq: t.seq,
        userMessage: t.userMessage,
        assistantResponse: t.assistantResponse,
      })),
  });

  await ctx.db.patch('chatroom_agenticQueries', args.queryId, {
    status: 'running',
    title,
    harnessSessionId,
    lastActiveAt: now,
    summary: undefined,
  });

  return { harnessSessionId, turnSeq: seq };
}

export const submit = mutation({
  args: {
    ...SessionIdArg,
    queryId: v.id('chatroom_agenticQueries'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    return submitAgenticMessage(ctx, args, ['draft']);
  },
});

export const submitFollowUp = mutation({
  args: {
    ...SessionIdArg,
    queryId: v.id('chatroom_agenticQueries'),
    message: v.string(),
  },
  handler: async (ctx, args) => {
    return submitAgenticMessage(ctx, args, ['complete', 'failed']);
  },
});

// fallow-ignore-next-line complexity
export const complete = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    queryId: v.id('chatroom_agenticQueries'),
    result: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const query = await ctx.db.get('chatroom_agenticQueries', args.queryId);
    if (!query) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Agentic query not found' });
    }

    const workspace = await ctx.db.get('chatroom_workspaces', query.workspaceId);
    if (!workspace || workspace.chatroomId !== args.chatroomId) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: 'Query does not belong to this chatroom',
      });
    }

    if (query.status !== 'running') {
      throw new ConvexError({
        code: 'INVALID_STATUS',
        message: `Query must be running to complete (current: ${query.status})`,
      });
    }

    const validation = validateAgenticQueryCompleteResult(args.result, query.mode);
    if (!validation.ok) {
      throw new ConvexError({ code: 'INVALID_RESULT', message: validation.message });
    }

    const turns = await getAgenticQueryTurns(ctx, args.queryId);
    const latestTurn = turns.sort((a, b) => b.seq - a.seq)[0];
    if (!latestTurn) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'No turns found for query' });
    }

    const now = Date.now();
    const assistantResponse = args.result.trim();

    await ctx.db.patch('chatroom_agenticQueryTurns', latestTurn._id, {
      assistantResponse,
      structuredResult: JSON.stringify({
        summary: validation.summary,
        results: validation.results,
        grounding: validation.grounding,
        files: validation.files,
      }),
    });

    await ctx.db.patch('chatroom_agenticQueries', args.queryId, {
      status: 'complete',
      lastActiveAt: now,
      summary: validation.summary,
    });

    if (query.harnessSessionId) {
      const harnessSession = await ctx.db.get('chatroom_harnessSessions', query.harnessSessionId);
      if (harnessSession && harnessSession.status !== 'closed') {
        await ctx.db.patch('chatroom_harnessSessions', query.harnessSessionId, {
          status: 'closed',
          lastActiveAt: now,
        });
      }
    }

    return { success: true as const };
  },
});
