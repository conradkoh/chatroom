import { ConvexError, v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import type { Id } from './_generated/dataModel';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireSession } from './auth/session';
import { resolveStandingInstructionForRoom } from './standingInstructionsResolver';
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

// ─── Public queries ───────────────────────────────────────────────────────

export const get = query({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
  },
  handler: async (ctx: QueryCtx, args) => {
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
    if (!room) {
      return { content: '', title: '', enabled: false };
    }
    const resolved = await resolveStandingInstructionForRoom(ctx, room);
    return {
      content: resolved.content,
      title: resolved.title,
      enabled: resolved.enabled,
      presetId: resolved.presetId as Id<'chatroom_standingInstructionHistory'> | undefined,
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

/**
 * Preset usage across the user's chatrooms. Active = enabled AND resolved
 * content non-empty; inactive = linked but disabled or empty.
 */
export const getPresetUsage = query({
  args: {
    ...SessionIdArg,
    presetId: v.id('chatroom_standingInstructionHistory'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const preset = await ctx.db.get('chatroom_standingInstructionHistory', args.presetId);
    if (!preset || preset.userId !== userId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Preset not found' });
    }
    const rooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', userId))
      .collect();
    const linked = rooms.filter((r) => r.standingInstructionPresetId === args.presetId);
    const usages = await Promise.all(
      linked.map(async (room) => {
        const resolved = await resolveStandingInstructionForRoom(ctx, room);
        return {
          chatroomId: room._id,
          title: room.name ?? 'Untitled',
          enabled: resolved.enabled && resolved.content.trim().length > 0,
        };
      })
    );
    const activeCount = usages.filter((u) => u.enabled).length;
    return {
      totalCount: usages.length,
      activeCount,
      inactiveCount: usages.length - activeCount,
      usages,
    };
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

    let presetId: Id<'chatroom_standingInstructionHistory'> | null = null;
    if (trimmed.length > 0) {
      presetId = await recordStandingInstructionHistory(
        ctx,
        session.userId,
        trimmed,
        trimmedTitle,
        Date.now()
      );
    }
    await ctx.db.patch('chatroom_rooms', args.chatroomId, {
      standingInstructions: trimmed,
      standingInstructionsEnabled: trimmed.length > 0,
      standingInstructionsTitle: trimmed.length > 0 ? trimmedTitle : undefined,
      standingInstructionPresetId: presetId ?? undefined,
    });
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
    return { content: row.content, title: row.title ?? '' };
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

/**
 * Update a shared preset and sync the denormalized fields on every
 * referencing chatroom so read-time resolution and legacy reads agree.
 */
export const updatePreset = mutation({
  args: {
    ...SessionIdArg,
    presetId: v.id('chatroom_standingInstructionHistory'),
    content: v.string(),
    title: v.string(),
  },
  // fallow-ignore-next-line complexity
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const preset = await ctx.db.get('chatroom_standingInstructionHistory', args.presetId);
    if (!preset || preset.userId !== userId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Preset not found' });
    }
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
    const contentKey = standingInstructionContentKey(trimmed);
    await ctx.db.patch('chatroom_standingInstructionHistory', args.presetId, {
      content: trimmed,
      title: trimmedTitle,
      contentKey,
    });
    const rooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', userId))
      .collect();
    for (const room of rooms) {
      if (room.standingInstructionPresetId !== args.presetId) continue;
      await ctx.db.patch('chatroom_rooms', room._id, {
        standingInstructions: trimmed,
        standingInstructionsTitle: trimmedTitle,
      });
    }
  },
});

/**
 * Delete a shared preset and unlink every referencing chatroom owned by the
 * user (content cleared, disabled). Distinct from `clear`, which only unlinks
 * the single chatroom while the preset library entry survives.
 */
export const deletePreset = mutation({
  args: {
    ...SessionIdArg,
    presetId: v.id('chatroom_standingInstructionHistory'),
  },
  handler: async (ctx, args) => {
    const { userId } = await requireSession(ctx, args.sessionId);
    const preset = await ctx.db.get('chatroom_standingInstructionHistory', args.presetId);
    if (!preset || preset.userId !== userId) {
      throw new ConvexError({ code: 'NOT_FOUND', message: 'Preset not found' });
    }
    const rooms = await ctx.db
      .query('chatroom_rooms')
      .withIndex('by_ownerId', (q) => q.eq('ownerId', userId))
      .collect();
    for (const room of rooms) {
      if (room.standingInstructionPresetId !== args.presetId) continue;
      await ctx.db.patch('chatroom_rooms', room._id, {
        standingInstructions: '',
        standingInstructionsEnabled: false,
        standingInstructionsTitle: undefined,
        standingInstructionPresetId: undefined,
      });
    }
    await ctx.db.delete('chatroom_standingInstructionHistory', args.presetId);
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
      standingInstructionPresetId: undefined,
    });
  },
});
