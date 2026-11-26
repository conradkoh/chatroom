import { ConvexError } from 'convex/values';

import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import {
  PAGE_PREVIEW_MAX_CHARS,
  PAGE_START_SENDER_ROLE,
  PAGE_START_TYPE,
  startsPage,
  type PageRef,
  type PageWindow,
} from '../../entities/conversation-page';

const EMPTY_PAGE_WINDOW: PageWindow = {
  pages: [],
  selectedPageId: null,
  prevPageId: null,
  nextPageId: null,
};

/**
 * Returns the start row for `pageId`, or null when the row no longer exists
 * (the caller falls back to the latest page).
 *
 * Throws `INVALID_MESSAGE` for a row in another chatroom and `INVALID_PAGE`
 * for a row that is not a page start.
 */
export async function getPageStartOrNull(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  pageId: Id<'chatroom_messages'>
): Promise<Doc<'chatroom_messages'> | null> {
  const row = await ctx.db.get('chatroom_messages', pageId);
  if (!row) return null;
  if (row.chatroomId !== chatroomId) {
    throw new ConvexError({
      code: 'INVALID_MESSAGE',
      message: 'Message does not belong to this chatroom',
    });
  }
  if (!startsPage(row)) {
    throw new ConvexError({ code: 'INVALID_PAGE', message: 'Page must start at a user message' });
  }
  return row;
}

async function findLatestStart(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<Doc<'chatroom_messages'> | null> {
  return await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom_senderRole_type_createdAt', (q) =>
      q
        .eq('chatroomId', chatroomId)
        .eq('senderRole', PAGE_START_SENDER_ROLE)
        .eq('type', PAGE_START_TYPE)
    )
    .order('desc')
    .first();
}

/** Reads up to `take` page starts on one side of `bound.time`, in time order. */
async function readStarts(
  ctx: QueryCtx,
  chatroomId: Id<'chatroom_rooms'>,
  bound: { op: 'lt' | 'gt'; time: number },
  order: 'asc' | 'desc',
  take: number
): Promise<Doc<'chatroom_messages'>[]> {
  return await ctx.db
    .query('chatroom_messages')
    .withIndex('by_chatroom_senderRole_type_createdAt', (q) => {
      const prefix = q
        .eq('chatroomId', chatroomId)
        .eq('senderRole', PAGE_START_SENDER_ROLE)
        .eq('type', PAGE_START_TYPE);
      return bound.op === 'lt'
        ? prefix.lt('_creationTime', bound.time)
        : prefix.gt('_creationTime', bound.time);
    })
    .order(order)
    .take(take);
}

/**
 * Maps an ascending chain of starts to page refs. Each page ends where the next
 * start begins; the last page uses the first start beyond the chain.
 */
function toPageRefs(chain: Doc<'chatroom_messages'>[], chainBoundary: number | null): PageRef[] {
  return chain.map((start, i) => {
    const next = chain[i + 1];
    return {
      pageId: start._id,
      startedAt: start._creationTime,
      endExclusive: next ? next._creationTime : chainBoundary,
      contentPreview: start.content.slice(0, PAGE_PREVIEW_MAX_CHARS),
    };
  });
}

function idAt(rows: Doc<'chatroom_messages'>[], index: number): Id<'chatroom_messages'> | null {
  return rows[index]?._id ?? null;
}

function timeAt(rows: Doc<'chatroom_messages'>[], index: number): number | null {
  return rows[index]?._creationTime ?? null;
}

/**
 * Assembles the ascending window around `selected`. The `+ 1` rows beyond each
 * span provide `prevPageId`/`nextPageId` and the boundary that ends the last
 * page in the chain.
 */
function buildPageWindow(
  selected: Doc<'chatroom_messages'>,
  older: Doc<'chatroom_messages'>[],
  newer: Doc<'chatroom_messages'>[],
  before: number,
  after: number
): PageWindow {
  const chain = [...older.slice(0, before).reverse(), selected, ...newer.slice(0, after)];
  return {
    pages: toPageRefs(chain, timeAt(newer, after)),
    selectedPageId: selected._id,
    prevPageId: idAt(older, before),
    nextPageId: idAt(newer, after),
  };
}

/**
 * Resolves a contiguous window of pages around the selected page, ascending.
 *
 * Reads only page boundaries: the requested page's start (when `pageId` is
 * given), the latest start only when no existing page is requested (a deleted
 * `pageId` counts as none), and two index takes (`before + 1` older,
 * `after + 1` newer) for the edges.
 */
export async function resolvePageWindow(
  ctx: QueryCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    pageId?: Id<'chatroom_messages'> | undefined;
    before: number;
    after: number;
  }
): Promise<PageWindow> {
  const { chatroomId, before, after } = args;

  const requested = args.pageId ? await getPageStartOrNull(ctx, chatroomId, args.pageId) : null;
  const selected = requested ?? (await findLatestStart(ctx, chatroomId));
  if (!selected) return EMPTY_PAGE_WINDOW;

  const [older, newer] = await Promise.all([
    readStarts(ctx, chatroomId, { op: 'lt', time: selected._creationTime }, 'desc', before + 1),
    readStarts(ctx, chatroomId, { op: 'gt', time: selected._creationTime }, 'asc', after + 1),
  ]);

  return buildPageWindow(selected, older, newer, before, after);
}
