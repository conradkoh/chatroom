/**
 * Web-facing agentic query run turn endpoints (streaming UI).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from '../../_generated/server';
import { getRunWithAccess, requireDirectHarnessWorkers } from '../../api/agenticQueryHelpers';
import {
  buildLatestTurnsPage,
  buildOlderTurnsPage,
  fetchStreamingTurnChunks,
  toHarnessTurnView,
} from '../../api/harnessTurnViewHelpers';

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

    return buildLatestTurnsPage(rows, limit);
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

    return rows.map(toHarnessTurnView);
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

    return buildOlderTurnsPage(rows, limit);
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

    return fetchStreamingTurnChunks(ctx, 'chatroom_agenticQueryRunMessages', {
      messageId: args.messageId,
      limit: args.limit ?? 200,
      afterCreationTime: args.afterCreationTime,
    });
  },
});
