/**
 * Message list API for the chatroom timeline feed.
 *
 * Queries:
 *   - subscribeLatestMessages — reactive latest N messages in chronological order
 *   - listMessagesBefore      — imperative load-older before a timestamp
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/core/chatroomAccess';
import { enrichMessages } from './messages';

/** Max rows for reactive latest-window and load-older page requests. */
const MAX_LATEST_MESSAGES_LIMIT = 200;
const MAX_LOAD_OLDER_PAGE_SIZE = 50;

/**
 * Reactive subscription for the latest N messages in a chatroom.
 *
 * Returns messages in ascending chronological order. Subscribed via
 * useSessionQuery; Convex re-runs when messages change.
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

    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress'))
      )
      .order('desc')
      .take(limit);

    const enriched = await enrichMessages(ctx, messages.reverse());
    return enriched;
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
      .filter((q) =>
        q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress'))
      )
      .order('desc')
      .take(limit);

    const enriched = await enrichMessages(ctx, messages.reverse());
    return enriched;
  },
});
