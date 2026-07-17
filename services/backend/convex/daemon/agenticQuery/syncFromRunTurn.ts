// fallow-ignore-file code-duplication complexity
import { validateAgenticQueryCompleteResult } from '../../../prompts/agentic-query/validate-complete-result';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  applyAgenticQueryComplete,
  markAgenticQueryFailed,
} from '../../web/agenticQuery/completeLogic';

/**
 * After an agentic run assistant turn finalizes, sync domain query state:
 * - Valid structured markdown → complete the query
 * - Empty response → mark failed
 * - Invalid markdown with content → save partial text and mark failed
 */
export async function trySyncAgenticQueryFromRunTurn(
  ctx: MutationCtx,
  params: {
    runId: Id<'chatroom_agenticQueryRuns'>;
    assistantText: string;
  }
): Promise<void> {
  const run = await ctx.db.get('chatroom_agenticQueryRuns', params.runId);
  if (!run) {
    return;
  }

  const query = await ctx.db.get('chatroom_agenticQueries', run.agenticQueryId);
  if (!query || query.status !== 'running') {
    return;
  }

  const text = params.assistantText.trim();
  if (!text) {
    await markAgenticQueryFailed(ctx, query, 'Agent produced no response');
    return;
  }

  const validation = validateAgenticQueryCompleteResult(text);
  if (!validation.ok) {
    await markAgenticQueryFailed(ctx, query, validation.message, text);
    return;
  }

  await applyAgenticQueryComplete(ctx, {
    queryId: run.agenticQueryId,
    result: text,
    runId: params.runId,
  });
}
