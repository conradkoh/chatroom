import type { Doc, Id } from '../../_generated/dataModel';
import { validateAgenticQueryCompleteResult } from '../../../prompts/agentic-query/validate-complete-result';
import type { MutationCtx } from '../../_generated/server';
import {
  applyAgenticQueryComplete,
  markAgenticQueryFailed,
} from '../../web/agenticQuery/completeLogic';

async function loadRunningQueryForRun(
  ctx: MutationCtx,
  runId: Id<'chatroom_agenticQueryRuns'>
): Promise<{
  run: Doc<'chatroom_agenticQueryRuns'>;
  query: Doc<'chatroom_agenticQueries'>;
} | null> {
  const run = await ctx.db.get('chatroom_agenticQueryRuns', runId);
  if (!run) return null;
  const query = await ctx.db.get('chatroom_agenticQueries', run.agenticQueryId);
  if (!query || query.status !== 'running') return null;
  return { run, query };
}

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
  const loaded = await loadRunningQueryForRun(ctx, params.runId);
  if (!loaded) return;

  const text = params.assistantText.trim();
  if (!text) {
    await markAgenticQueryFailed(ctx, loaded.query, 'Agent produced no response');
    return;
  }

  const validation = validateAgenticQueryCompleteResult(text);
  if (!validation.ok) {
    await markAgenticQueryFailed(ctx, loaded.query, validation.message, text);
    return;
  }

  await applyAgenticQueryComplete(ctx, {
    queryId: loaded.run.agenticQueryId,
    result: text,
    runId: params.runId,
  });
}
