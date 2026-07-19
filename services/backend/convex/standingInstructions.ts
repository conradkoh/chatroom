import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
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

// ─── Internal helpers ─────────────────────────────────────────────────────

async function recordStandingInstructionHistory(
  ctx: MutationCtx,
  userId: Id<'users'>,
  rawContent: string,
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
    });
    return existing._id;
  }
  return await ctx.db.insert('chatroom_standingInstructionHistory', {
    userId,
    content,
    contentKey,
    useCount: 1,
    lastUsedAt: now,
    createdAt: now,
  });
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
  },
  handler: async (ctx, args) => {
    const { session } = await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const trimmed = args.content.trim();
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new ConvexError({
        code: 'CONTENT_TOO_LONG',
        message: `Standing instructions must be ${MAX_CONTENT_LENGTH} characters or less`,
      });
    }
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: trimmed,
      standingInstructionsEnabled: trimmed.length > 0,
    });
    if (trimmed.length > 0) {
      await recordStandingInstructionHistory(ctx, session.userId, trimmed, Date.now());
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
    const row = await ctx.db.get('chatroom_standingInstructionHistory', args.historyId);
    if (!row || row.userId !== userId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'History item not found' });
    }
    const now = Date.now();
    await ctx.db.patch('chatroom_standingInstructionHistory', row._id, {
      useCount: row.useCount + 1,
      lastUsedAt: now,
    });
    return { content: row.content };
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
    });
  },
});
