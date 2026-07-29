/**
 * Message list API for the chatroom timeline feed.
 *
 * Queries:
 *   - getLatestMessages               — one-shot initial load (imperative)
 *   - subscribeNewMessages            — reactive tail from a NEWEST-row cursor (strict >)
 *   - subscribeTaskStatusSignalsSince — reactive task-status signals from cursor
 *   - listMessagesBefore              — imperative load-older before a timestamp
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { enrichMessages } from './messages';

/** Max rows for initial latest-window and load-older page requests. */
const MAX_LATEST_MESSAGES_LIMIT = 200;
const MAX_LOAD_OLDER_PAGE_SIZE = 50;
/** Max rows for the strict-after "new messages" tail (prevents unbounded growth). */
const MAX_NEW_MESSAGES_LIMIT = 500;
/** Max rows for task-status signals cursor page. */
const MAX_TASK_STATUS_SIGNALS_LIMIT = 500;

export function isTimelineMessage(msg: Doc<'chatroom_messages'>): boolean {
  return msg.type !== 'join' && msg.type !== 'progress';
}

async function fetchLatestTimelineWindow(
  ctx: QueryCtx,
  chatroomId: Doc<'chatroom_messages'>['chatroomId'],
  limit: number
): Promise<{ messages: Doc<'chatroom_messages'>[]; hasMore: boolean }> {
  // Over-fetch raw rows so join/progress rows do not hide older timeline messages.
  let batchSize = limit + 1;
  const maxBatch = Math.min(limit * 4, MAX_LATEST_MESSAGES_LIMIT);

  while (batchSize <= maxBatch) {
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
      .order('desc')
      .take(batchSize);

    const timelineDesc = rows.filter(isTimelineMessage);
    if (timelineDesc.length > limit) {
      return {
        messages: timelineDesc.slice(0, limit).reverse(),
        hasMore: true,
      };
    }
    if (rows.length < batchSize) {
      return {
        messages: timelineDesc.reverse(),
        hasMore: false,
      };
    }
    batchSize += limit;
  }

  const rows = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .order('desc')
    .take(maxBatch);
  const timelineDesc = rows.filter(isTimelineMessage);
  return {
    messages: timelineDesc.slice(0, limit).reverse(),
    hasMore: timelineDesc.length > limit,
  };
}

/**
 * Fetch timeline messages strictly after a `_creationTime` cursor (ascending), bounded.
 *
 * Strict (`> afterCreationTime`) so the newest-cursor "new messages" tail never re-sends
 * the cursor row itself.
 */
async function fetchMessagesStrictlyAfter(
  ctx: QueryCtx,
  chatroomId: Doc<'chatroom_messages'>['chatroomId'],
  afterCreationTime: number,
  limit: number
): Promise<Doc<'chatroom_messages'>[]> {
  const rows = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) =>
      q.eq('chatroomId', chatroomId).gt('_creationTime', afterCreationTime)
    )
    .order('asc')
    .take(limit);

  return rows.filter(isTimelineMessage);
}

async function getLatestTaskStatusSignalKey(
  ctx: QueryCtx,
  chatroomId: Doc<'chatroom_rooms'>['_id']
): Promise<string> {
  const latest = await ctx.db
    .query('chatroom_timelineTaskStatusSignals')
    .withIndex('by_chatroom_signalKey', (q) => q.eq('chatroomId', chatroomId))
    .order('desc')
    .first();
  return latest?.signalKey ?? '';
}

/**
 * One-shot initial load: latest `limit` timeline messages (oldest→newest) plus
 * pagination metadata. Called imperatively — no reactive subscription.
 *
 * `tailAfterCreationTime` is the _creationTime of the oldest message in the
 * returned window (or 0 when empty), kept for backward compatibility. The frontend
 * derives its own newest-row cursor for subscribeNewMessages.
 */
export const getLatestMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = Math.min(Math.max(args.limit, 1), MAX_LATEST_MESSAGES_LIMIT);

    const { messages: window, hasMore } = await fetchLatestTimelineWindow(
      ctx,
      args.chatroomId,
      limit
    );
    const enriched = await enrichMessages(ctx, window);
    const tailAfterCreationTime = window[0]?._creationTime ?? 0;

    return {
      messages: enriched,
      hasMore,
      tailAfterCreationTime,
      taskStatusAfterKey: await getLatestTaskStatusSignalKey(ctx, args.chatroomId),
    };
  },
});

/**
 * Reactive "new messages" tail: timeline messages with `_creationTime > afterCreationTime`.
 *
 * The frontend pins `afterCreationTime` to the NEWEST message it has seen and advances it
 * as new messages arrive — so this subscription's result stays near-empty and each new
 * message is delivered roughly once. Task-status changes to already-visible messages are
 * handled separately by subscribeTaskStatusSignalsSince.
 */
export const subscribeNewMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    afterCreationTime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const messages = await fetchMessagesStrictlyAfter(
      ctx,
      args.chatroomId,
      args.afterCreationTime,
      MAX_NEW_MESSAGES_LIMIT
    );
    return await enrichMessages(ctx, messages);
  },
});

const DEFAULT_TASK_STATUS_SIGNALS_LIMIT = 100;

/**
 * Reactive cursor-pinned subscription: task-status signals strictly after
 * `afterKey`. Returns a paginated page with `highKey` for cursor advancement.
 *
 * Returns null when idle (no new signals) to suppress subscription bandwidth.
 */
export const subscribeTaskStatusSignalsSince = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    afterKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = Math.min(
      Math.max(args.limit ?? DEFAULT_TASK_STATUS_SIGNALS_LIMIT, 1),
      MAX_TASK_STATUS_SIGNALS_LIMIT
    );
    const page = await ctx.db
      .query('chatroom_timelineTaskStatusSignals')
      .withIndex('by_chatroom_signalKey', (q) =>
        q.eq('chatroomId', args.chatroomId).gt('signalKey', args.afterKey)
      )
      .order('asc')
      .take(limit + 1);

    const hasMore = page.length > limit;
    const rows = page.slice(0, limit);
    const items = rows.map((row) => ({
      taskId: row.taskId,
      taskStatus: row.taskStatus,
      signalKey: row.signalKey,
    }));
    if (items.length === 0) {
      return null;
    }
    return {
      items,
      highKey: items[items.length - 1]!.signalKey,
      hasMore,
    };
  },
});

/**
 * Imperative load-older — messages strictly before `before` (_creationTime).
 *
 * Returns up to `limit` messages in ascending chronological order so the
 * caller can prepend them to local state.
 */
export const listMessagesBefore = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    before: v.number(),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = Math.min(Math.max(args.limit, 1), MAX_LOAD_OLDER_PAGE_SIZE);

    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) =>
        q.eq('chatroomId', args.chatroomId).lt('_creationTime', args.before)
      )
      .filter((q) => q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress')))
      .order('desc')
      .take(limit);

    const enriched = await enrichMessages(ctx, messages.reverse());
    return enriched;
  },
});
