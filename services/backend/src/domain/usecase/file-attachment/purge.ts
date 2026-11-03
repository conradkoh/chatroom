/**
 * File attachment expiry — removes unbound rows whose TTL has elapsed.
 *
 * `pending_upload` rows never carry a blob or usage; `uploaded` rows do, and
 * both are handled by the shared deletion golden path. `attached` rows are
 * owned by the handoff and are never expired here.
 */

import { deleteFileAttachments } from './lifecycle';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { FILE_EXPIRY_BATCH_SIZE } from '../../entities/file-attachment';

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
