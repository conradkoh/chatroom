/**
 * Cursor-paginated message list API.
 *
 * This module provides the new paginated message queries built on Convex's
 * built-in pagination primitives. The legacy queries (getLatestMessages,
 * getMessagesSince, getOlderMessages) have been removed from messages.ts.
 *
 * Queries:
 *   - listMessages        — paginated historical messages (newest-first per page)
 *   - subscribeNewMessages — reactive tail subscription for new arrivals
 */

import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/core/chatroomAccess';
import { enrichMessages } from './messages';

/**
 * Paginated historical messages for a chatroom.
 *
 * Returns messages in descending _creationTime order (newest first per page).
 * The frontend should reverse each page for chronological display.
 *
 * Filters out 'join' and 'progress' message types (display-only types not
 * included in the feed).
 *
 * Use with Convex's usePaginatedQuery hook:
 *   usePaginatedQuery(api.messageList.listMessages, { chatroomId, ... }, { initialNumItems: 20 })
 */
export const listMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .filter((q) =>
        q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress'))
      )
      .order('desc')
      .paginate(args.paginationOpts);

    const enriched = await enrichMessages(ctx, result.page);
    return { ...result, page: enriched };
  },
});

/**
 * Reactive tail subscription — messages newer than `sinceCreationTime`.
 *
 * Subscribed to via useSessionQuery; Convex re-runs this query whenever new
 * messages arrive in the chatroom. Returns messages in ascending
 * chronological order. Capped at 200 messages to prevent unbounded returns.
 *
 * Invariant: any message with _creationTime > sinceCreationTime is unseen.
 * Pass the newest known _creationTime as the boundary.
 */
export const subscribeNewMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    sinceCreationTime: v.number(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const messages = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) =>
        q.eq('chatroomId', args.chatroomId).gt('_creationTime', args.sinceCreationTime)
      )
      .filter((q) =>
        q.and(q.neq(q.field('type'), 'join'), q.neq(q.field('type'), 'progress'))
      )
      .order('asc')
      .take(200); // safety cap — prevents unbounded returns

    return enrichMessages(ctx, messages);
  },
});
