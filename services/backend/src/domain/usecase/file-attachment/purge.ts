/**
 * File attachment maintenance — expiry, quota eviction, and manual purge.
 *
 * Every function here is a bounded batch that deletes through the lifecycle
 * golden path (`deleteFileAttachments`), so usage counters stay exact (I3) and
 * no transaction can exceed Convex read/delete limits.
 */

import { getFileUsage, getUserQuotaBytes, resolveFileQuotas } from './accounting';
import { deleteFileAttachments } from './lifecycle';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import {
  FILE_EVICTION_BATCH_SIZE,
  FILE_EXPIRY_BATCH_SIZE,
  FILE_PURGE_BATCH_SIZE,
} from '../../entities/file-attachment';

/**
 * Deletes up to `FILE_EXPIRY_BATCH_SIZE` expired attachment rows.
 *
 * Fetches expired `pending_upload` rows first, then fills the remaining budget
 * with expired `uploaded` rows. Rows are deleted through the batch golden path
 * so usage is decremented in one call per owner.
 *
 * `hasMore` is true when a full batch was fetched, signalling the caller to
 * reschedule an immediate follow-up run.
 */
export async function expireStaleUploadsBatch(
  ctx: MutationCtx,
  now: number
): Promise<{ deleted: number; hasMore: boolean }> {
  const pendingRows = await ctx.db
    .query('chatroom_fileAttachments')
    .withIndex('by_status_expiresAt', (q) => q.eq('status', 'pending_upload').lt('expiresAt', now))
    .take(FILE_EXPIRY_BATCH_SIZE);

  const remaining = FILE_EXPIRY_BATCH_SIZE - pendingRows.length;
  const uploadedRows =
    remaining > 0
      ? await ctx.db
          .query('chatroom_fileAttachments')
          .withIndex('by_status_expiresAt', (q) => q.eq('status', 'uploaded').lt('expiresAt', now))
          .take(remaining)
      : [];

  const rows = [...pendingRows, ...uploadedRows];
  await deleteFileAttachments(ctx, rows);

  return {
    deleted: rows.length,
    hasMore: rows.length === FILE_EXPIRY_BATCH_SIZE,
  };
}

/**
 * Evicts oldest-first until the chatroom (when given) and then the user scope
 * are back within quota.
 *
 * Only `attached` rows are candidates: in-flight `uploaded` rows are never
 * evicted because their owner may still be handing them off. The chatroom scope
 * runs first so a room-level breach does not consume the user-wide budget.
 *
 * `hasMore` is true only when the full batch was consumed and the scope is still
 * over quota — that means more candidates may remain, so the caller reschedules.
 */
export async function evictOverQuotaBatch(
  ctx: MutationCtx,
  args: { userId: Id<'users'>; chatroomId?: Id<'chatroom_rooms'> | undefined }
): Promise<{ deleted: number; hasMore: boolean }> {
  let deleted = 0;
  let hasMore = false;

  if (args.chatroomId !== undefined) {
    const chatroomId = args.chatroomId;
    const quotas = await resolveFileQuotas(ctx, { userId: args.userId, chatroomId });
    const usage = await getFileUsage(ctx, { userId: args.userId, chatroomId });
    const chatroomResult = await evictScope(
      ctx,
      usage.bytes - quotas.effectiveChatroomQuotaBytes,
      async (limit) =>
        await ctx.db
          .query('chatroom_fileAttachments')
          .withIndex('by_chatroom_status_attachedAt', (q) =>
            q.eq('chatroomId', chatroomId).eq('status', 'attached')
          )
          .order('asc')
          .take(limit)
    );
    deleted += chatroomResult.deleted;
    hasMore = chatroomResult.hasMore;
  }

  // Re-read after chatroom deletions: those bytes also left the user total.
  const userQuotaBytes = await getUserQuotaBytes(ctx, args.userId);
  const userUsage = await getFileUsage(ctx, { userId: args.userId });
  const userResult = await evictScope(
    ctx,
    userUsage.bytes - userQuotaBytes,
    async (limit) =>
      await ctx.db
        .query('chatroom_fileAttachments')
        .withIndex('by_owner_status_attachedAt', (q) =>
          q.eq('ownerUserId', args.userId).eq('status', 'attached')
        )
        .order('asc')
        .take(limit)
  );

  return {
    deleted: deleted + userResult.deleted,
    hasMore: hasMore || userResult.hasMore,
  };
}

/** Deletes the oldest candidates until `overBytes` is covered. */
async function evictScope(
  ctx: MutationCtx,
  overBytes: number,
  fetchCandidates: (limit: number) => Promise<Doc<'chatroom_fileAttachments'>[]>
): Promise<{ deleted: number; hasMore: boolean }> {
  if (overBytes <= 0) return { deleted: 0, hasMore: false };

  const candidates = await fetchCandidates(FILE_EVICTION_BATCH_SIZE);
  const { rows, remaining } = selectEvictionCandidates(candidates, overBytes);
  await deleteFileAttachments(ctx, rows);

  return {
    deleted: rows.length,
    hasMore: remaining > 0 && candidates.length === FILE_EVICTION_BATCH_SIZE,
  };
}

/** Takes oldest rows until their bytes cover the overage. */
function selectEvictionCandidates(
  candidates: Doc<'chatroom_fileAttachments'>[],
  overBytes: number
): { rows: Doc<'chatroom_fileAttachments'>[]; remaining: number } {
  const rows: Doc<'chatroom_fileAttachments'>[] = [];
  let remaining = overBytes;
  for (const row of candidates) {
    if (remaining <= 0) break;
    rows.push(row);
    remaining -= row.sizeBytes;
  }
  return { rows, remaining };
}

/**
 * Purges attached rows for one chatroom (when given) or the whole user.
 *
 * `minSizeBytes` keeps the purge targeted at large files; `0`/absent matches
 * every attached row. `hasMore` is true when a full batch was consumed.
 */
export async function purgeFilesBatch(
  ctx: MutationCtx,
  args: {
    userId: Id<'users'>;
    chatroomId?: Id<'chatroom_rooms'> | undefined;
    minSizeBytes?: number | undefined;
  }
): Promise<{ deleted: number; hasMore: boolean }> {
  const minSizeBytes = args.minSizeBytes ?? 0;
  const { chatroomId } = args;

  const rows =
    chatroomId !== undefined
      ? await ctx.db
          .query('chatroom_fileAttachments')
          .withIndex('by_chatroom_status_sizeBytes', (q) =>
            q.eq('chatroomId', chatroomId).eq('status', 'attached').gte('sizeBytes', minSizeBytes)
          )
          .take(FILE_PURGE_BATCH_SIZE)
      : await ctx.db
          .query('chatroom_fileAttachments')
          .withIndex('by_owner_status_sizeBytes', (q) =>
            q.eq('ownerUserId', args.userId).eq('status', 'attached').gte('sizeBytes', minSizeBytes)
          )
          .take(FILE_PURGE_BATCH_SIZE);

  await deleteFileAttachments(ctx, rows);

  return { deleted: rows.length, hasMore: rows.length === FILE_PURGE_BATCH_SIZE };
}
