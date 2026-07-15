// fallow-ignore-file complexity

import { validateAgenticQueryCompleteResult } from '../../../prompts/agentic-query/validate-complete-result';
import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import {
  applyAgenticQueryComplete,
  markAgenticQueryFailed,
} from '../../web/agenticQuery/completeLogic';

/**
 * After a harness assistant turn finalizes, sync agentic-query sessions:
 * - Valid structured markdown → complete the query
 * - Empty response → mark failed
 * - Invalid markdown with content → save partial text and mark failed
 */
export async function trySyncAgenticQueryFromHarnessTurn(
  ctx: MutationCtx,
  params: {
    harnessSessionId: Id<'chatroom_harnessSessions'>;
    assistantText: string;
  }
): Promise<void> {
  const harnessSession = await ctx.db.get('chatroom_harnessSessions', params.harnessSessionId);
  if (
    !harnessSession ||
    harnessSession.purpose !== 'agentic-query' ||
    !harnessSession.agenticQueryId
  ) {
    return;
  }

  const query = await ctx.db.get('chatroom_agenticQueries', harnessSession.agenticQueryId);
  if (!query || query.status !== 'running') {
    return;
  }

  const text = params.assistantText.trim();
  if (!text) {
    await markAgenticQueryFailed(ctx, query, 'Agent produced no response');
    return;
  }

  const validation = validateAgenticQueryCompleteResult(text, query.mode);
  if (!validation.ok) {
    await markAgenticQueryFailed(ctx, query, validation.message, text);
    return;
  }

  await applyAgenticQueryComplete(ctx, {
    queryId: harnessSession.agenticQueryId,
    result: text,
    harnessSessionId: params.harnessSessionId,
  });
}
