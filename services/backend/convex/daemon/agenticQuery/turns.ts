// fallow-ignore-file code-duplication complexity
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { trySyncAgenticQueryFromRunTurn } from './syncFromRunTurn';
import type { Id } from '../../_generated/dataModel';
import { mutation } from '../../_generated/server';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import {
  getNextRunTurnSeq,
  getRunWithAccess,
  requireDirectHarnessWorkers,
  requireRunOnOwnedMachine,
} from '../../api/agenticQueryHelpers';
import { requireMachineOwner } from '../../auth/cli/machineAccess';

export const beginAssistantTurn = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();
    await getRunWithAccess(ctx, args.sessionId, args.runId);

    const turnSeq = await getNextRunTurnSeq(ctx, args.runId);

    const turnId = await ctx.db.insert('chatroom_agenticQueryRunTurns', {
      runId: args.runId,
      turnSeq,
      role: 'assistant',
      status: 'pending',
      textContent: '',
      reasoningContent: '',
      startedAt: Date.now(),
    });

    return { turnId, turnSeq };
  },
});

export const markTurnProcessed = mutation({
  args: {
    ...SessionIdArg,
    runId: v.id('chatroom_agenticQueryRuns'),
    turnSeq: v.number(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const run = await ctx.db.get('chatroom_agenticQueryRuns', args.runId);
    if (!run) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Agentic query run ${args.runId} not found`,
      });
    }

    const workspace = await ctx.db.get('chatroom_workspaces', run.workspaceId);
    if (!workspace) {
      throw new ConvexError({
        code: 'NOT_FOUND',
        message: `Workspace ${run.workspaceId} not found`,
      });
    }

    await requireMachineOwner(ctx, args.sessionId, workspace.machineId);

    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      lastProcessedTurnSeq: args.turnSeq,
    });
  },
});

export const bindTurnMessageId = mutation({
  args: {
    ...SessionIdArg,
    turnId: v.id('chatroom_agenticQueryRunTurns'),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const turn = await ctx.db.get('chatroom_agenticQueryRunTurns', args.turnId);
    if (!turn) return;

    await getRunWithAccess(ctx, args.sessionId, turn.runId);

    if (turn.status !== 'pending') return;
    if (turn.role !== 'assistant') return;

    await ctx.db.patch('chatroom_agenticQueryRunTurns', args.turnId, {
      status: 'streaming',
      messageId: args.messageId,
    });
  },
});

export const finalizeAssistantTurn = mutation({
  args: {
    ...SessionIdArg,
    turnId: v.id('chatroom_agenticQueryRunTurns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    const turn = await ctx.db.get('chatroom_agenticQueryRunTurns', args.turnId);
    if (!turn) return;

    if (turn.status === 'complete') return;

    await getRunWithAccess(ctx, args.sessionId, turn.runId);

    const { textContent, reasoningContent } = await aggregateChunksForRunTurn(ctx, turn);

    await ctx.db.patch('chatroom_agenticQueryRunTurns', args.turnId, {
      status: 'complete',
      textContent,
      reasoningContent,
      completedAt: Date.now(),
    });

    await trySyncAgenticQueryFromRunTurn(ctx, {
      runId: turn.runId,
      assistantText: textContent,
    });

    return { ok: true };
  },
});

export async function aggregateChunksForRunTurn(
  ctx: { db: MutationCtx['db'] | QueryCtx['db'] },
  turn: {
    runId: Id<'chatroom_agenticQueryRuns'>;
    turnSeq: number;
    startedAt: number;
  }
): Promise<{ textContent: string; reasoningContent: string }> {
  const nextTurn = await ctx.db
    .query('chatroom_agenticQueryRunTurns')
    .withIndex('by_run_turnSeq', (q) => q.eq('runId', turn.runId).gt('turnSeq', turn.turnSeq))
    .order('asc')
    .first();

  const upperBound = nextTurn?.startedAt ?? Number.MAX_SAFE_INTEGER;

  const chunks = await ctx.db
    .query('chatroom_agenticQueryRunMessages')
    .withIndex('by_run_role', (q) => q.eq('runId', turn.runId).eq('role', 'assistant'))
    .collect();

  let textContent = '';
  let reasoningContent = '';
  for (const chunk of chunks) {
    const chunkTime = chunk._creationTime;
    if (chunkTime < turn.startedAt || chunkTime >= upperBound) continue;
    const partType = chunk.partType ?? 'text';
    if (partType === 'text') {
      textContent += chunk.content;
    } else if (partType === 'reasoning') {
      reasoningContent += chunk.content;
    }
  }
  return { textContent, reasoningContent };
}

export const markOrphanTurnsFailed = mutation({
  args: {
    ...SessionIdArg,
    machineId: v.string(),
    runId: v.id('chatroom_agenticQueryRuns'),
  },
  handler: async (ctx, args) => {
    requireDirectHarnessWorkers();

    await requireRunOnOwnedMachine(ctx, args.sessionId, args.machineId, args.runId);

    const now = Date.now();
    let failedCount = 0;

    const streamingTurns = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_status', (q) => q.eq('runId', args.runId).eq('status', 'streaming'))
      .collect();

    for (const turn of streamingTurns) {
      const aggregated = await aggregateChunksForRunTurn(ctx, turn);
      await ctx.db.patch('chatroom_agenticQueryRunTurns', turn._id, {
        status: 'failed',
        textContent: aggregated.textContent,
        reasoningContent: aggregated.reasoningContent,
        completedAt: now,
      });
      failedCount++;
    }

    const pendingTurns = await ctx.db
      .query('chatroom_agenticQueryRunTurns')
      .withIndex('by_run_status', (q) => q.eq('runId', args.runId).eq('status', 'pending'))
      .collect();

    for (const turn of pendingTurns) {
      await ctx.db.patch('chatroom_agenticQueryRunTurns', turn._id, {
        status: 'failed',
        completedAt: now,
      });
      failedCount++;
    }

    await ctx.db.patch('chatroom_agenticQueryRuns', args.runId, {
      isGenerating: false,
    });

    return { failedTurns: failedCount };
  },
});
