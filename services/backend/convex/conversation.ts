import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { clampPageSpan } from '../src/domain/entities/conversation-page';
import { NON_TIMELINE_MESSAGE_TYPES } from '../src/domain/entities/message';
import {
  getPageStartOrNull,
  resolvePageWindow,
} from '../src/domain/usecase/conversation/resolve-page-window';
import { enrichMessages } from '../src/domain/usecase/message/enrich-messages';

/** Max rows returned by the reactive tail. */
const MAX_PAGE_TAIL_LIMIT = 100;

/** Pages (start messages) before and after the selected one, with ids and previews. */
export const listPages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    pageId: v.optional(v.id('chatroom_messages')),
    before: v.optional(v.number()),
    after: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    return resolvePageWindow(ctx, {
      chatroomId: args.chatroomId,
      pageId: args.pageId,
      before: clampPageSpan(args.before),
      after: clampPageSpan(args.after),
    });
  },
});

/** Timeline messages of one page, paginated ascending. `endExclusive: null` means the open latest page. */
export const listPageMessages = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    pageId: v.id('chatroom_messages'),
    endExclusive: v.optional(v.union(v.number(), v.null())),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const start = await getPageStartOrNull(ctx, args.chatroomId, args.pageId);
    if (!start) return { page: [], isDone: true, continueCursor: '' };
    const end = args.endExclusive ?? null;
    const result = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => {
        const range = q.eq('chatroomId', args.chatroomId).gte('_creationTime', start._creationTime);
        return end === null ? range : range.lt('_creationTime', end);
      })
      .filter((q) => q.and(...NON_TIMELINE_MESSAGE_TYPES.map((t) => q.neq(q.field('type'), t))))
      .order('asc')
      .paginate(args.paginationOpts);
    return { ...result, page: await enrichMessages(ctx, result.page) };
  },
});

/** Reactive tail after the last loaded row, bounded by the page's endExclusive. Null when empty. */
export const subscribePageTail = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    afterCreationTime: v.number(),
    endExclusive: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) => {
        const range = q
          .eq('chatroomId', args.chatroomId)
          .gt('_creationTime', args.afterCreationTime);
        return args.endExclusive === null ? range : range.lt('_creationTime', args.endExclusive);
      })
      .filter((q) => q.and(...NON_TIMELINE_MESSAGE_TYPES.map((t) => q.neq(q.field('type'), t))))
      .order('asc')
      .take(MAX_PAGE_TAIL_LIMIT);
    if (rows.length === 0) return null;
    return enrichMessages(ctx, rows);
  },
});
