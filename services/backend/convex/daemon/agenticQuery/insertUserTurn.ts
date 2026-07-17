import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { getNextRunTurnSeq } from '../../api/agenticQueryHelpers';

export async function insertAgenticQueryUserTurn(
  ctx: { db: MutationCtx['db'] },
  runId: Id<'chatroom_agenticQueryRuns'>,
  content: string,
  timestamp: number
): Promise<{ turnId: Id<'chatroom_agenticQueryRunTurns'>; turnSeq: number }> {
  const turnSeq = await getNextRunTurnSeq(ctx, runId);
  const turnId = await ctx.db.insert('chatroom_agenticQueryRunTurns', {
    runId,
    turnSeq,
    role: 'user',
    status: 'complete',
    textContent: content.trim(),
    reasoningContent: '',
    startedAt: timestamp,
    completedAt: timestamp,
  });
  await ctx.db.patch('chatroom_agenticQueryRuns', runId, { lastActiveAt: timestamp });
  return { turnId, turnSeq };
}
