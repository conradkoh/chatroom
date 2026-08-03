import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Doc, Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireSession } from './auth/session';
import {
  compareStandingInstructionHistoryByRank,
  normalizeStandingInstructionContent,
  standingInstructionContentKey,
} from '../src/domain/entities/standing-instructions';

const MAX_CONTENT_LENGTH = 10_000;
const MAX_TITLE_LENGTH = 120;

// ─── Internal helpers ─────────────────────────────────────────────────────

// fallow-ignore-next-line complexity
async function recordStandingInstructionHistory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  rawContent: string,
  title: string,
  now: number
): Promise<Id<'chatroom_standingInstructionHistory'> | null> {
  const content = normalizeStandingInstructionContent(rawContent);
  if (!content) return null;
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new ConvexError({
      code: 'CONTENT_TOO_LONG',
      message: `Standing instructions must be ${MAX_CONTENT_LENGTH} characters or less`,
    });
  }
  const contentKey = standingInstructionContentKey(content);
  const existing = await ctx.db
    .query('chatroom_standingInstructionHistory')
    .withIndex('by_userId_contentKey', (q) => q.eq('userId', userId).eq('contentKey', contentKey))
    .first();
  if (existing) {
    await ctx.db.patch('chatroom_standingInstructionHistory', existing._id, {
      useCount: existing.useCount + 1,
      lastUsedAt: now,
      content,
      title,
    });
    return existing._id;
  }
  return await ctx.db.insert('chatroom_standingInstructionHistory', {
    userId,
    content,
    contentKey,
    title,
    useCount: 1,
    lastUsedAt: now,
    createdAt: now,
  });
}

async function requireOwnedHistoryRow(
  ctx: MutationCtx,
  historyId: Id<'chatroom_standingInstructionHistory'>,
  userId: Id<'users'>
): Promise<Doc<'chatroom_standingInstructionHistory'>> {
  const row = await ctx.db.get('chatroom_standingInstructionHistory', historyId);
  if (!row || row.userId !== userId) {
    throw new ConvexError({ code: 'NOT_FOUND', message: 'History item not found' });
  }
  return row;
}

// ─── Public queries ───────────────────────────────────────────────────────

export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
    return {
      content: room?.standingInstructions ?? '',
      enabled: room?.standingInstructionsEnabled ?? false,
      title: room?.standingInstructionsTitle ?? '',
    };
  },
});

export const listHistory = query({
  args: { ...SessionIdArg },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const rows = await ctx.db
      .query('chatroom_standingInstructionHistory')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .collect();
    rows.sort(compareStandingInstructionHistoryByRank);
    return rows.map((row) => ({
      _id: row._id,
      content: row.content,
      title: row.title ?? '',
      useCount: row.useCount,
      lastUsedAt: row.lastUsedAt,
    }));
  },
});

// ─── Public mutations ─────────────────────────────────────────────────────

export const upsert = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    content: v.string(),
    title: v.string(),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const trimmed = args.content.trim();
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError({
        code: 'CONTENT_TOO_LONG',
        message: `Standing instructions must be ${MAX_CONTENT_LENGTH} characters or less`,
      });
    }
    const trimmedTitle = args.title.trim();
    if (trimmed.length > 0 && !trimmedTitle) {
      throw new ConvexError({
        code: 'TITLE_REQUIRED',
        message: 'A title is required for standing instructions',
      });
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      throw new ConvexError({
        code: 'TITLE_TOO_LONG',
        message: `Standing instruction title must be ${MAX_TITLE_LENGTH} characters or less`,
      });
    }
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: trimmed,
      standingInstructionsEnabled: trimmed.length > 0,
      standingInstructionsTitle: trimmed.length > 0 ? trimmedTitle : undefined,
    });
    if (trimmed.length > 0) {
      await recordStandingInstructionHistory(
        ctx,
        session.userId,
        trimmed,
        trimmedTitle,
        Date.now()
      );
    }
  },
});

export const recordUse = mutation({
  args: {
    ...SessionIdArg,
    historyId: v.id('chatroom_standingInstructionHistory'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const row = await requireOwnedHistoryRow(ctx, args.historyId, userId);
    const now = Date.now();
    await ctx.db.patch('chatroom_standingInstructionHistory', row._id, {
      useCount: row.useCount + 1,
      lastUsedAt: now,
    });
    return { content: row.content, title: row.title ?? '' };
  },
});

export const updateHistory = mutation({
  args: {
    ...SessionIdArg,
    historyId: v.id('chatroom_standingInstructionHistory'),
    content: v.string(),
    title: v.string(),
    /** When true, also applies the update to every owned chatroom currently using this template. */
    applyToOwnerChatrooms: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const row = await requireOwnedHistoryRow(ctx, args.historyId, userId);
    const oldContentKey = row.contentKey;
    const trimmed = normalizeStandingInstructionContent(args.content);
    if (!trimmed) {
      throw new ConvexError({
        code: 'CONTENT_EMPTY',
        message: 'Standing instruction content cannot be empty',
      });
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError({
        code: 'CONTENT_TOO_LONG',
        message: `Standing instructions must be ${MAX_CONTENT_LENGTH} characters or less`,
      });
    }
    const trimmedTitle = args.title.trim();
    if (!trimmedTitle) {
      throw new ConvexError({
        code: 'TITLE_REQUIRED',
        message: 'A title is required for standing instructions',
      });
    }
    if (trimmedTitle.length > MAX_TITLE_LENGTH) {
      throw new ConvexError({
        code: 'TITLE_TOO_LONG',
        message: `Standing instruction title must be ${MAX_TITLE_LENGTH} characters or less`,
      });
    }
    const contentKey = standingInstructionContentKey(trimmed);
    const conflict = await ctx.db
      .query('chatroom_standingInstructionHistory')
      .withIndex('by_userId_contentKey', (q) => q.eq('userId', userId).eq('contentKey', contentKey))
      .first();
    if (conflict && conflict._id !== args.historyId) {
      throw new ConvexError({
        code: 'CONFLICT',
        message: 'Another standing instruction with this content already exists',
      });
    }
    await ctx.db.patch('chatroom_standingInstructionHistory', args.historyId, {
      content: trimmed,
      contentKey,
      title: trimmedTitle,
    });
    if (args.applyToOwnerChatrooms) {
      await propagateHistoryUpdate(ctx, userId, oldContentKey, trimmed, trimmedTitle);
    }
  },
});

/**
 * Push a history-template update to every chatroom the user owns whose current
 * standing instructions match the previous content key. Only content + title
 * are patched — `standingInstructionsEnabled` is preserved.
 */
async function propagateHistoryUpdate(
  ctx: MutationCtx,
  ownerId: Id<'users'>,
  oldContentKey: string,
  content: string,
  title: string
): Promise<void> {
  const ownedRooms = await ctx.db
    .query('chatroom_rooms')
    .withIndex('by_ownerId', (q) => q.eq('ownerId', ownerId))
    .collect();

  for (const room of ownedRooms) {
    const roomContent = room.standingInstructions?.trim() ?? '';
    if (roomContent.length === 0) continue;
    if (standingInstructionContentKey(roomContent) !== oldContentKey) continue;
    await ctx.db.patch('chatroom_rooms', room._id, {
      standingInstructions: content,
      standingInstructionsTitle: title,
    });
  }
}

export const deleteHistory = mutation({
  args: {
    ...SessionIdArg,
    historyId: v.id('chatroom_standingInstructionHistory'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    await requireOwnedHistoryRow(ctx, args.historyId, userId);
    await ctx.db.delete('chatroom_standingInstructionHistory', args.historyId);
  },
});

export const setEnabled = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    enabled: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    if (!args.enabled) {
      await ctx.db.patch('chatroom_rooms', args.chatroomId, {
        standingInstructionsEnabled: false,
      });
      return;
    }
    const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!room?.standingInstructions?.trim()) return;
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructionsEnabled: true,
    });
  },
});

// fallow-ignore-next-line code-duplication
export const clear = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: '',
      standingInstructionsEnabled: false,
      standingInstructionsTitle: undefined,
    });
  },
});
