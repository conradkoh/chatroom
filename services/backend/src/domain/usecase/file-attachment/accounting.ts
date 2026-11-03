/**
 * File attachment storage accounting — quota resolution and the single writer
 * of `chatroom_fileStorageUsage`.
 *
 * Invariant I3: for each user, the user-total row (`chatroomId` undefined) and
 * every per-chatroom row equal the Σ `sizeBytes` and file count of that scope's
 * attachment rows whose status is `uploaded` or `attached`. Only
 * `applyFileUsageDelta` writes these counters, and it rejects any transition
 * that would drive a counter negative.
 */

import { ConvexError } from 'convex/values';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../../../convex/_generated/server';
import {
  DEFAULT_CHATROOM_FILE_QUOTA_BYTES,
  DEFAULT_USER_FILE_QUOTA_BYTES,
} from '../../entities/file-attachment';

/** Chatroom scope for the user-total row. */
const USER_TOTAL_CHATROOM_ID = undefined;

interface FileUsageDelta {
  chatroomId: Id<'chatroom_rooms'>;
  bytes: number;
  files: number;
}

/**
 * Applies usage deltas to the per-chatroom rows and the user-total row.
 *
 * Deltas are aggregated per chatroom; the user-total row receives the sum of
 * every delta exactly once. Missing rows are created at zero before being
 * patched, so the counter is always materialized after the first write.
 *
 * @throws ConvexError `VALIDATION_ERROR` when a resulting counter is negative —
 * this is an invariant breach (I3), never a user input error.
 */
export async function applyFileUsageDelta(
  ctx: MutationCtx,
  args: { userId: Id<'users'>; deltas: FileUsageDelta[] }
): Promise<void> {
  if (args.deltas.length === 0) return;

  const totals = aggregateUsageDeltas(args.deltas);
  const now = Date.now();
  for (const [chatroomId, delta] of totals.perChatroom) {
    await applyScopeDelta(ctx, args.userId, chatroomId, delta, now);
  }
  await applyScopeDelta(ctx, args.userId, USER_TOTAL_CHATROOM_ID, totals, now);
}

interface UsageTotals {
  bytes: number;
  files: number;
}

/** Aggregates deltas per chatroom and once for the user total. */
function aggregateUsageDeltas(deltas: FileUsageDelta[]): {
  perChatroom: Map<Id<'chatroom_rooms'>, UsageTotals>;
  bytes: number;
  files: number;
} {
  const perChatroom = new Map<Id<'chatroom_rooms'>, UsageTotals>();
  let bytes = 0;
  let files = 0;

  for (const delta of deltas) {
    bytes += delta.bytes;
    files += delta.files;
    const existing = perChatroom.get(delta.chatroomId) ?? { bytes: 0, files: 0 };
    existing.bytes += delta.bytes;
    existing.files += delta.files;
    perChatroom.set(delta.chatroomId, existing);
  }

  return { perChatroom, bytes, files };
}

/** Reads, creates, and patches one usage scope with a non-negative guard. */
async function applyScopeDelta(
  ctx: MutationCtx,
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'> | undefined,
  delta: UsageTotals,
  now: number
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_fileStorageUsage')
    .withIndex('by_userId_chatroomId', (q) => q.eq('userId', userId).eq('chatroomId', chatroomId))
    .unique();

  if (!existing) {
    await createScopeRow(ctx, userId, chatroomId, delta, now);
    return;
  }

  const next = {
    bytes: existing.bytes + delta.bytes,
    fileCount: existing.fileCount + delta.files,
  };
  assertCounterNonNegative(chatroomId, next);
  await ctx.db.patch('chatroom_fileStorageUsage', existing._id, {
    ...next,
    updatedAt: now,
  });
}

/** Creates a zeroed counter row, then patches it to the first delta. */
async function createScopeRow(
  ctx: MutationCtx,
  userId: Id<'users'>,
  chatroomId: Id<'chatroom_rooms'> | undefined,
  delta: UsageTotals,
  now: number
): Promise<void> {
  assertCounterNonNegative(chatroomId, {
    bytes: delta.bytes,
    fileCount: delta.files,
  });
  const created = await ctx.db.insert('chatroom_fileStorageUsage', {
    userId,
    ...(chatroomId === undefined ? {} : { chatroomId }),
    bytes: 0,
    fileCount: 0,
    updatedAt: now,
  });
  await ctx.db.patch('chatroom_fileStorageUsage', created, {
    bytes: delta.bytes,
    fileCount: delta.files,
    updatedAt: now,
  });
}

/** Throws when a counter update would breach invariant I3. */
function assertCounterNonNegative(
  chatroomId: Id<'chatroom_rooms'> | undefined,
  next: { bytes: number; fileCount: number }
): void {
  if (next.bytes >= 0 && next.fileCount >= 0) return;

  const scopeLabel = chatroomId === undefined ? 'user total' : `chatroom ${chatroomId}`;
  throw new ConvexError({
    code: 'VALIDATION_ERROR',
    message: `File storage usage invariant breach: ${scopeLabel} would drop below zero`,
  });
}

/** Resolves the user quota, chatroom quota, and their effective minimum. */
export async function resolveFileQuotas(
  ctx: QueryCtx,
  args: { userId: Id<'users'>; chatroomId: Id<'chatroom_rooms'> }
): Promise<{
  userQuotaBytes: number;
  chatroomQuotaBytes: number;
  effectiveChatroomQuotaBytes: number;
}> {
  const userQuotaBytes = await getUserQuotaBytes(ctx, args.userId);

  const chatroomSettings = await ctx.db
    .query('chatroom_fileStorageSettings')
    .withIndex('by_chatroomId', (q) => q.eq('chatroomId', args.chatroomId))
    .unique();
  const chatroomQuotaBytes = chatroomSettings?.quotaBytes ?? DEFAULT_CHATROOM_FILE_QUOTA_BYTES;

  return {
    userQuotaBytes,
    chatroomQuotaBytes,
    effectiveChatroomQuotaBytes: Math.min(chatroomQuotaBytes, userQuotaBytes),
  };
}

/** Reads the user's quota override, falling back to the platform default. */
// fallow-ignore-next-line unused-export
export async function getUserQuotaBytes(ctx: QueryCtx, userId: Id<'users'>): Promise<number> {
  const settings = await ctx.db
    .query('chatroom_userFileStorageSettings')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .unique();
  return settings?.quotaBytes ?? DEFAULT_USER_FILE_QUOTA_BYTES;
}
