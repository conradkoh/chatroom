// fallow-ignore-file code-duplication

/**
 * Web-facing agentic query run turn endpoints (streaming UI).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from '../../_generated/server';
import { getRunWithAccess, requireDirectHarnessWorkers } from '../../api/agenticQueryHelpers';

function toView(row: {
  _id: string;
  turnSeq: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'streaming' | 'complete' | 'failed';
  messageId?: string;
  textContent: string;
  reasoningContent: string;
  startedAt: number;
  completedAt?: number;
  [key: string]: unknown;
}) {
  return {
    _id: row._id,
    turnSeq: row.turnSeq,
    role: row.role,
    status: row.status,
    messageId: row.messageId,
    textContent: row.textContent,
    reasoningContent: row.reasoningContent,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
  };
}

export const getLatestTurns = query({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_turnSeq', (q) => q.eq('runId', args.runId))
      .order('desc')
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const turns = rows.slice(0, limit).reverse().map(toView);
    const newestTurnSeq = turns.at(-1)?.turnSeq ?? null;

    return { turns, hasMore, newestTurnSeq };
  },
});

export const getTurnsSince = query({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    afterTurnSeq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    const rows = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_turnSeq', (q) =>
        q.eq('runId', args.runId).gt('turnSeq', args.afterTurnSeq)
      )
      .order('asc')
      .collect();

    return rows.map(toView);
  },
});

export const getOlderTurns = query({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    beforeTurnSeq: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    const limit = args.limit ?? 50;

    const rows = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_turnSeq', (q) =>
        q.eq('runId', args.runId).lt('turnSeq', args.beforeTurnSeq)
      )
      .order('desc')
      .take(limit + 1);

    const hasMore = rows.length > limit;
    const turns = rows.slice(0, limit).reverse().map(toView);

    return { turns, hasMore };
  },
});

export const getStreamingTurnChunks = query({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    messageId: v.string(),
    limit: v.optional(v.number()),
    afterCreationTime: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    const limit = args.limit ?? 200;

    const baseIdx = ctx.db
      .query('chatroom_agenticQueryRunMessages')
      .withIndex('by_messageId', (q) => {
        const eq = q.eq('messageId', args.messageId);
        return args.afterCreationTime !== undefined
          ? eq.gte('_creationTime', args.afterCreationTime)
          : eq;
      });

    if (args.afterCreationTime !== undefined) {
      return await baseIdx.order('asc').take(limit);
    }

    const rows = await baseIdx.order('desc').take(limit);
    rows.sort((a, b) => a._creationTime - b._creationTime);
    return rows;
  },
});
