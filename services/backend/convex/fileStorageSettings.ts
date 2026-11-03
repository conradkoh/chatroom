/**
 * File storage settings — per-user and per-chatroom quota management.
 *
 * Settings live in their own tables (`chatroom_userFileStorageSettings`,
 * `chatroom_fileStorageSettings`); a missing row means the platform default, so
 * reads never insert. Every function requires a web session, and chatroom reads
 * or writes require ownership of that chatroom.
 *
 * Lowering a quota below current usage schedules the oldest-first eviction
 * batch; usage counters stay the single source of truth (I3).
 */

import { v } from 'convex/values';
import { SessionIdArg } from 'convex-helpers/server/sessions';

import { internal } from './_generated/api';
import { mutation, query } from './_generated/server';
import { requireChatroomAccess } from './auth/chatroomAccess';
import { requireWebCaller } from './fileAttachments';
import {
  DEFAULT_USER_FILE_QUOTA_BYTES,
  PLATFORM_MAX_FILE_QUOTA_BYTES,
} from '../src/domain/entities/file-attachment';
import {
  assertValidQuotaBytes,
  getFileUsage,
  resolveFileQuotas,
} from '../src/domain/usecase/file-attachment/accounting';

/** Returns the caller's quota, whether it is the default, and current usage. */
export const getUserFileStorage = query({
  args: { ...SessionIdArg },
  returns: v.object({
    quotaBytes: v.number(),
    isDefault: v.boolean(),
    platformMaxQuotaBytes: v.number(),
    usage: v.object({ bytes: v.number(), fileCount: v.number() }),
  }),
  handler: async (ctx, args) => {
    const { userId } = await requireWebCaller(ctx, args.sessionId);

    const settings = await ctx.db
      .query('chatroom_userFileStorageSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();

    return {
      quotaBytes: settings?.quotaBytes ?? DEFAULT_USER_FILE_QUOTA_BYTES,
      isDefault: settings === null,
      platformMaxQuotaBytes: PLATFORM_MAX_FILE_QUOTA_BYTES,
      usage: await getFileUsage(ctx, { userId }),
    };
  },
});

/** Stores the caller's user-wide quota and evicts if usage now exceeds it. */
export const setUserFileStorageQuota = mutation({
  args: { ...SessionIdArg, quotaBytes: v.number() },
  returns: v.object({ quotaBytes: v.number(), evictionScheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireWebCaller(ctx, args.sessionId);
    assertValidQuotaBytes(args.quotaBytes);

    const existing = await ctx.db
      .query('chatroom_userFileStorageSettings')
      .withIndex('by_userId', (q) => q.eq('userId', userId))
      .unique();

    if (existing) {
      await ctx.db.patch('chatroom_userFileStorageSettings', existing._id, {
        quotaBytes: args.quotaBytes,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert('chatroom_userFileStorageSettings', {
        userId,
        quotaBytes: args.quotaBytes,
        updatedAt: Date.now(),
      });
    }

    const usage = await getFileUsage(ctx, { userId });
    const evictionScheduled = usage.bytes > args.quotaBytes;
    if (evictionScheduled) {
      await ctx.scheduler.runAfter(0, internal.fileAttachments.enforceQuota, { userId });
    }

    return { quotaBytes: args.quotaBytes, evictionScheduled };
  },
});

/** Returns a chatroom's quota, the user cap, and the effective minimum. */
export const getChatroomFileStorage = query({
  args: { ...SessionIdArg, chatroomId: v.id('chatroom_rooms') },
  returns: v.object({
    quotaBytes: v.number(),
    isDefault: v.boolean(),
    userQuotaBytes: v.number(),
    effectiveQuotaBytes: v.number(),
    platformMaxQuotaBytes: v.number(),
    usage: v.object({ bytes: v.number(), fileCount: v.number() }),
  }),
  handler: async (ctx, args) => {
    const { userId } = await requireWebCaller(ctx, args.sessionId);
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);

    const settings = await ctx.db
      .query('chatroom_fileStorageSettings')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', args.chatroomId))
      .unique();
    const quotas = await resolveFileQuotas(ctx, {
      userId,
      chatroomId: args.chatroomId,
    });

    return {
      quotaBytes: quotas.chatroomQuotaBytes,
      isDefault: settings === null,
      userQuotaBytes: quotas.userQuotaBytes,
      effectiveQuotaBytes: quotas.effectiveChatroomQuotaBytes,
      platformMaxQuotaBytes: PLATFORM_MAX_FILE_QUOTA_BYTES,
      usage: await getFileUsage(ctx, { userId, chatroomId: args.chatroomId }),
    };
  },
});

/** Stores a chatroom quota and evicts if the room now exceeds its cap. */
export const setChatroomFileStorageQuota = mutation({
  args: {
    ...SessionIdArg,
    chatroomId: v.id('chatroom_rooms'),
    quotaBytes: v.number(),
  },
  returns: v.object({ quotaBytes: v.number(), evictionScheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId } = await requireWebCaller(ctx, args.sessionId);
    await requireChatroomAccess(ctx, args.sessionId, args.chatroomId);
    assertValidQuotaBytes(args.quotaBytes);

    const existing = await ctx.db
      .query('chatroom_fileStorageSettings')
      .withIndex('by_chatroomId', (q) => q.eq('chatroomId', args.chatroomId))
      .unique();

    if (existing) {
      await ctx.db.patch('chatroom_fileStorageSettings', existing._id, {
        quotaBytes: args.quotaBytes,
        updatedBy: userId,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert('chatroom_fileStorageSettings', {
        chatroomId: args.chatroomId,
        quotaBytes: args.quotaBytes,
        updatedBy: userId,
        updatedAt: Date.now(),
      });
    }

    const quotas = await resolveFileQuotas(ctx, {
      userId,
      chatroomId: args.chatroomId,
    });
    const usage = await getFileUsage(ctx, { userId, chatroomId: args.chatroomId });
    const evictionScheduled = usage.bytes > quotas.effectiveChatroomQuotaBytes;
    if (evictionScheduled) {
      await ctx.scheduler.runAfter(0, internal.fileAttachments.enforceQuota, {
        userId,
        chatroomId: args.chatroomId,
      });
    }

    return { quotaBytes: args.quotaBytes, evictionScheduled };
  },
});
