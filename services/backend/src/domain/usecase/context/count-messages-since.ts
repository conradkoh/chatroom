/**
 * count-messages-since usecase helper
 *
 * Counts how many messages a chatroom has accrued since a given timestamp
 * (typically the creation time of the current pinned context) to drive
 * "stale context" staleness hints.
 *
 * ## Why a cap
 *
 * Callers only need this value for a threshold decision (show a staleness
 * warning) plus a display hint — never an exact total. A plain `.collect()`
 * over `by_chatroom` reads the FULL document of every message since the
 * context, just to call `.length`. On busy chatrooms that re-reads a large,
 * growing set of message bodies on every poll of hot paths like
 * `getTaskDeliveryPrompt` / `get-next-task`.
 *
 * Instead we `.take(SAMPLE_LIMIT)`, bounding the read to a small constant
 * number of message documents. The returned count therefore saturates at
 * `SAMPLE_LIMIT`: a value of `SAMPLE_LIMIT` means "at least `THRESHOLD`+1"
 * (render it as "`THRESHOLD`+"). `SAMPLE_LIMIT` is `THRESHOLD + 1` so every
 * existing staleness threshold (the largest in use is `THRESHOLD`) still
 * evaluates identically — only the displayed number saturates.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

/**
 * Largest "messages since context" staleness threshold in use across callers
 * (the read-task renderer flags staleness at this count). Counts at or above
 * this are treated as "stale".
 */
export const STALE_CONTEXT_MESSAGE_THRESHOLD = 50;

/**
 * Maximum number of message documents read when counting messages since a
 * context. One above the threshold so the threshold comparison is preserved
 * exactly while the overflow value (`SAMPLE_LIMIT`) signals "THRESHOLD+".
 */
export const STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT = STALE_CONTEXT_MESSAGE_THRESHOLD + 1;

/**
 * Counts messages in a chatroom created at/after `sinceTimestamp`, bounded by
 * `STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT`.
 *
 * Uses the `by_chatroom` index for an indexed range scan from `sinceTimestamp`
 * forward (implicit `_creationTime` tie-breaker), then `.take(...)` to cap the
 * number of documents read. The result is `min(actualCount, SAMPLE_LIMIT)`.
 */
export async function countMessagesSinceCapped(
  ctx: { db: QueryCtx['db'] },
  chatroomId: Id<'chatroom_rooms'>,
  sinceTimestamp: number
): Promise<number> {
  const messages = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) =>
      q.eq('chatroomId', chatroomId).gte('_creationTime', sinceTimestamp)
    )
    .take(STALE_CONTEXT_MESSAGE_SAMPLE_LIMIT);
  return messages.length;
}

/**
 * Formats a (possibly saturated) "messages since context" count for display.
 * Renders the saturated overflow value as "`THRESHOLD`+" so the bounded read
 * is represented honestly; otherwise returns the exact number as a string.
 */
export function formatMessagesSinceContext(count: number): string {
  return count > STALE_CONTEXT_MESSAGE_THRESHOLD
    ? `${STALE_CONTEXT_MESSAGE_THRESHOLD}+`
    : String(count);
}
