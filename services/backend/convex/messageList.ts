/**
 * Message list API for the chatroom timeline feed.
 *
 * Queries:
 *   - getLatestMessages        — one-shot initial load (imperative)
 *   - subscribeMessagesSince   — reactive tail from a pinned _creationTime cursor
 *   - listMessagesBefore       — imperative load-older before a timestamp
 *   - subscribeLatestMessages  — legacy full-window subscription (deprecated for webapp)
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
/** Max rows for reactive tail subscription (prevents unbounded growth). */
const MAX_MESSAGES_SINCE_LIMIT = 500;

function isTimelineMessage(msg: Doc<'chatroom_messages'>): boolean {
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

async function fetchMessagesSince(
  ctx: QueryCtx,
  chatroomId: Doc<'chatroom_messages'>['chatroomId'],
  afterCreationTime: number
): Promise<Doc<'chatroom_messages'>[]> {
  const rows = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom', (q) =>
      q.eq('chatroomId', chatroomId).gte('_creationTime', afterCreationTime)
    )
    .order('asc')
    .take(MAX_MESSAGES_SINCE_LIMIT);

  return rows.filter(isTimelineMessage);
}

/**
 * One-shot initial load: latest `limit` timeline messages (oldest→newest) plus
 * pagination metadata. Called imperatively — no reactive subscription.
 *
 * `tailAfterCreationTime` is the _creationTime of the oldest message in the
 * returned window (or 0 when empty). Pass it to subscribeMessagesSince so the
 * tail subscription includes status updates on visible messages and all new ones.
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
    };
  },
});

/**
 * Reactive tail subscription: timeline messages with `_creationTime >= afterCreationTime`.
 *
 * Pin `afterCreationTime` to `tailAfterCreationTime` from getLatestMessages (oldest
 * visible row). Convex re-runs when rows in this range are inserted or patched, and
 * when linked tasks change (via enrichMessages). The frontend merges by `_id`.
 */
export const subscribeMessagesSince = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    afterCreationTime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const messages = await fetchMessagesSince(ctx, args.chatroomId, args.afterCreationTime);
    return await enrichMessages(ctx, messages);
  },
});

/**
 * Reactive subscription for the latest N messages in a chatroom.
 *
 * @deprecated Prefer getLatestMessages + subscribeMessagesSince for delta tail updates.
 */
export const subscribeLatestMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = Math.min(Math.max(args.limit, 1), MAX_LATEST_MESSAGES_LIMIT);
    const { messages } = await fetchLatestTimelineWindow(ctx, args.chatroomId, limit);
    return await enrichMessages(ctx, messages);
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
