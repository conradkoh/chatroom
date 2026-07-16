// fallow-ignore-file complexity

import { getAgenticQueryTurns } from './internal';
import { validateAgenticQueryCompleteResult } from '../../../prompts/agentic-query/validate-complete-result';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';

export interface ApplyAgenticQueryCompleteParams {
  queryId: Id<'chatroom_agenticQueries'>;
  result: string;
  harnessSessionId?: Id<'chatroom_harnessSessions'>;
}

export type ApplyAgenticQueryCompleteResult =
  | { ok: true; summary: string }
  | {
      ok: false;
      reason: 'not_found' | 'invalid_status' | 'no_turns' | 'invalid_result';
      message: string;
    };

export async function applyAgenticQueryComplete(
  ctx: MutationCtx,
  params: ApplyAgenticQueryCompleteParams
): Promise<ApplyAgenticQueryCompleteResult> {
  const query = await ctx.db.get('chatroom_agenticQueries', params.queryId);
  if (!query) {
    return { ok: false, reason: 'not_found', message: 'Agentic query not found' };
  }

  if (query.status !== 'running') {
    return {
      ok: false,
      reason: 'invalid_status',
      message: `Query must be running to complete (current: ${query.status})`,
    };
  }

  const validation = validateAgenticQueryCompleteResult(params.result);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid_result', message: validation.message };
  }

  const turns = await getAgenticQueryTurns(ctx, params.queryId);
  const latestTurn = turns.sort((a, b) => b.seq - a.seq)[0];
  if (!latestTurn) {
    return { ok: false, reason: 'no_turns', message: 'No turns found for query' };
  }

  const now = Date.now();
  const assistantResponse = params.result.trim();

  await ctx.db.patch('chatroom_agenticQueryTurns', latestTurn._id, {
    assistantResponse,
    structuredResult: JSON.stringify({
      summary: validation.summary,
      results: validation.results,
      grounding: validation.grounding,
      files: validation.files,
    }),
  });

  await ctx.db.patch('chatroom_agenticQueries', params.queryId, {
    status: 'complete',
    lastActiveAt: now,
    summary: validation.summary,
  });

  const harnessSessionId = params.harnessSessionId ?? query.harnessSessionId;
  if (harnessSessionId) {
    const harnessSession = await ctx.db.get('chatroom_harnessSessions', harnessSessionId);
    if (harnessSession && harnessSession.status !== 'closed') {
      await ctx.db.patch('chatroom_harnessSessions', harnessSessionId, {
        status: 'closed',
        lastActiveAt: now,
      });
    }
  }

  return { ok: true, summary: validation.summary };
}

export async function markAgenticQueryFailed(
  ctx: MutationCtx,
  query: Doc<'chatroom_agenticQueries'>,
  message: string,
  partialResponse?: string
): Promise<void> {
  const now = Date.now();
  const turns = await getAgenticQueryTurns(ctx, query._id);
  const latestTurn = turns.sort((a, b) => b.seq - a.seq)[0];

  if (latestTurn && partialResponse?.trim()) {
    await ctx.db.patch('chatroom_agenticQueryTurns', latestTurn._id, {
      assistantResponse: partialResponse.trim(),
    });
  }

  await ctx.db.patch('chatroom_agenticQueries', query._id, {
    status: 'failed',
    lastActiveAt: now,
    summary: message.slice(0, 200),
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
}
