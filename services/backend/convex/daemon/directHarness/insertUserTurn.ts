import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import { getNextTurnSeq } from '../../api/directHarnessHelpers';

/**
 * Inserts a user turn row into chatroom_harnessSessionTurns.
 * Used by the three user-message write sites (web/sessions.create,
 * web/messages.send, daemon/queue.dequeueNext).
 */
export async function insertUserTurn(
  ctx: { db: MutationCtx['db'] },
  harnessSessionId: Id<'chatroom_harnessSessions'>,
  content: string,
  timestamp: number
): Promise<{ turnId: Id<'chatroom_harnessSessionTurns'>; turnSeq: number }> {
  const turnSeq = await getNextTurnSeq(ctx, harnessSessionId);
  const turnId = await ctx.db.insert('chatroom_harnessSessionTurns', {
    harnessSessionId,
    turnSeq,
    role: 'user',
    status: 'complete',
    textContent: content.trim(),
    reasoningContent: '',
    startedAt: timestamp,
    completedAt: timestamp,
  });
  await ctx.db.patch('chatroom_harnessSessions', harnessSessionId, { lastActiveAt: timestamp });
  return { turnId, turnSeq };
}
