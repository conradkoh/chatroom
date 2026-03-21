/** Convex functions for querying chatroom event stream. */

import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/cliSessionAuth';

/**
 * Returns the latest N events for a chatroom from the event stream,
 * ordered newest-first.
 */
export const listLatestEvents = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const limit = args.limit ?? 20;

    const events = await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .take(limit);

    return events;
  },
});

/**
 * Paginated version of listLatestEvents.
 * Returns events for a chatroom using Convex's built-in pagination,
 * ordered newest-first. Use loadMore() to fetch additional pages.
 */
export const listLatestEventsPaginated = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    return await ctx.db
      .query('chatroom_eventStream')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .order('desc')
      .paginate(args.paginationOpts);
  },
});
