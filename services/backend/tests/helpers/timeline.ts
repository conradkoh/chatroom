import type { Doc, Id } from '../../convex/_generated/dataModel';
import type { QueryCtx } from '../../convex/_generated/server';
import { isTimelineMessageType } from '../../src/domain/entities/message';

/**
 * Timeline rows (no join/progress) for a chatroom, ascending by creation time.
 *
 * Test-only reader of `chatroom_messages`. Replaces the deleted timeline-feed
 * reader while keeping the same timeline filter the page reader applies
 * (`isTimelineMessageType`).
 */
export async function readTimelineMessagesForTest(
  t: { run: <R>(fn: (ctx: QueryCtx) => Promise<R>) => Promise<R> },
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_messages'>[]> {
  return await t.run(async (ctx) => {
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .order('asc')
      .collect();
    return rows.filter((row) => isTimelineMessageType(row.type));
  });
}
