import { paginationOptsValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { isTimelineMessage } from './messageList';
import { enrichMessages } from './messages';

function isUserMessageAnchor(msg: Doc<'chatroom_messages'>): boolean {
  return msg.senderRole.toLowerCase() === 'user' && msg.type === 'message';
}

async function getAnchorOrThrow(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  anchorMessageId: Id<'chatroom_messages'>
): Promise<Doc<'chatroom_messages'>> {
  const anchor = await ctx.db.get('chatroom_messages', anchorMessageId);
  if (!anchor) {
    throw new ConvexError({ code: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
  }
  if (anchor.chatroomId !== chatroomId) {
    throw new ConvexError({
      code: 'INVALID_MESSAGE',
      message: 'Message does not belong to this chatroom',
    });
  }
  if (!isUserMessageAnchor(anchor)) {
    throw new ConvexError({ code: 'INVALID_ANCHOR', message: 'Anchor must be a user message' });
  }
  return anchor;
}

async function findLatestUserAnchor(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_messages'> | null> {
  return (
    (await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .order('desc')
      .first()) ?? null
  );
}

async function findAdjacentUserAnchor(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  anchor: Doc<'chatroom_messages'>,
  direction: 'prev' | 'next'
): Promise<Id<'chatroom_messages'> | null> {
  if (direction === 'prev') {
    const older = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .filter((q) => q.lt(q.field('_creationTime'), anchor._creationTime))
      .order('desc')
      .first();
    return older?._id ?? null;
  }
  const newer = await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
      q.eq('chatroomId', chatroomId).eq('senderRole', 'user').eq('type', 'message')
    )
    .filter((q) => q.gt(q.field('_creationTime'), anchor._creationTime))
    .order('asc')
    .first();
  return newer?._id ?? null;
}

async function findNextUserMessageAfter(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  anchorCreationTime: number
): Promise<Doc<'chatroom_messages'> | null> {
  return (
    (await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
        q.eq('chatroomId', chatroomId).eq('senderRole', 'user').eq('type', 'message')
      )
      .filter((q) => q.gt(q.field('_creationTime'), anchorCreationTime))
      .order('asc')
      .first()) ?? null
  );
}

/** Resolve current anchor + prev/next navigation ids. */
export const getAllTabAnchorNavigation = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    anchorMessageId: v.optional(v.id('chatroom_messages')),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const anchor = args.anchorMessageId
      ? await getAnchorOrThrow(ctx, args.chatroomId, args.anchorMessageId)
      : await findLatestUserAnchor(ctx, args.chatroomId);

    if (!anchor) {
      return {
        anchor: null,
        prevAnchorId: null,
        nextAnchorId: null,
        sliceUpperBoundExclusive: null,
      };
    }

    const nextUserMessage = await findNextUserMessageAfter(
      ctx,
      args.chatroomId,
      anchor._creationTime
    );

    const [prevAnchorId, nextAnchorId] = await Promise.all([
      findAdjacentUserAnchor(ctx, args.chatroomId, anchor, 'prev'),
      findAdjacentUserAnchor(ctx, args.chatroomId, anchor, 'next'),
    ]);

    return {
      anchor: {
        _id: anchor._id,
        _creationTime: anchor._creationTime,
        contentPreview: anchor.content.slice(0, 120),
      },
      prevAnchorId,
      nextAnchorId,
      sliceUpperBoundExclusive: nextUserMessage?._creationTime ?? null,
    };
  },
});

/** Paginated slice: anchor inclusive → before next user message. Ascending. */
export const listAllTabSlicePaginated = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    anchorMessageId: v.id('chatroom_messages'),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const anchor = await getAnchorOrThrow(ctx, args.chatroomId, args.anchorMessageId);
    const nextUserMessage = await findNextUserMessageAfter(
      ctx,
      args.chatroomId,
      anchor._creationTime
    );
    const upperBoundExclusive = nextUserMessage?._creationTime ?? null;

    let cursor = args.paginationOpts.cursor;
    let isDone = false;
    const collected: Doc<'chatroom_messages'>[] = [];
    const numItems = args.paginationOpts.numItems;

    while (collected.length < numItems && !isDone) {
      const batch = await ctx.db
        .query('chatroom_messages')
        .withIndex('by_chatroom', (q) =>
          q.eq('chatroomId', args.chatroomId).gte('_creationTime', anchor._creationTime)
        )
        .order('asc')
        .paginate({ ...args.paginationOpts, cursor, numItems: numItems * 2 });

      for (const msg of batch.page) {
        if (upperBoundExclusive !== null && msg._creationTime >= upperBoundExclusive) {
          isDone = true;
          break;
        }
        if (!isTimelineMessage(msg)) continue;
        collected.push(msg);
        if (collected.length >= numItems) break;
      }

      cursor = batch.continueCursor;
      isDone = isDone || batch.isDone;
      if (batch.page.length === 0) break;
    }

    const page = await enrichMessages(ctx, collected.slice(0, numItems));
    return {
      page,
      isDone,
      continueCursor: cursor,
      sliceMetadata: {
        anchorMessageId: anchor._id,
        nextUserMessageId: nextUserMessage?._id ?? null,
        upperBoundExclusive,
      },
    };
  },
});

const MAX_SLICE_TAIL_LIMIT = 100;

/** Reactive tail for the active slice (strictly after cursor, before upper bound). */
export const subscribeAllTabSliceTail = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    afterCreationTime: v.number(),
    upperBoundExclusive: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const rows = await ctx.db
      .query('chatroom_messages')
      .withIndex('by_chatroom', (q) =>
        q.eq('chatroomId', args.chatroomId).gt('_creationTime', args.afterCreationTime)
      )
      .order('asc')
      .take(MAX_SLICE_TAIL_LIMIT);

    const filtered = rows.filter((msg) => {
      if (!isTimelineMessage(msg)) return false;
      if (args.upperBoundExclusive !== null && msg._creationTime >= args.upperBoundExclusive) {
        return false;
      }
      return true;
    });

    if (filtered.length === 0) return null;
    return await enrichMessages(ctx, filtered);
  },
});
