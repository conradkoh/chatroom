import { internalMutation } from './_generated/server';

/** Storage-backed uploads older than this are expired. */
const STALE_UPLOAD_REQUEST_AGE_MS = 30 * 60 * 1000;

const EXPIRE_BATCH_SIZE = 50;

function isExpiredStorageUpload(
  request: {
    storageId?: string;
    requestedAt: number;
    status: string;
  },
  cutoff: number
): boolean {
  if (!request.storageId) return false;
  if (request.status !== 'pending' && request.status !== 'processing') return false;
  return request.requestedAt < cutoff;
}

/**
 * Expires stale storage-backed write requests and deletes orphaned blobs.
 */
export const expireStaleWorkspaceUploadRequests = internalMutation({
  args: {},
  // fallow-ignore-next-line complexity
  handler: async (ctx) => {
    const cutoff = Date.now() - STALE_UPLOAD_REQUEST_AGE_MS;
    const candidates = await ctx.db
      .query('chatroom_workspaceFileWriteRequests')
      .withIndex('by_machine_status')
      .filter((q) =>
        q.or(q.eq(q.field('status'), 'pending'), q.eq(q.field('status'), 'processing'))
      )
      .take(EXPIRE_BATCH_SIZE * 4);

    let expired = 0;
    for (const request of candidates) {
      if (!isExpiredStorageUpload(request, cutoff)) continue;

      const storageId = request.storageId;
      if (!storageId) continue;

      await ctx.db.patch('chatroom_workspaceFileWriteRequests', request._id, {
        status: 'error',
        errorMessage: 'Upload expired',
        updatedAt: Date.now(),
      });
      await ctx.storage.delete(storageId);
      expired++;
      if (expired >= EXPIRE_BATCH_SIZE) break;
    }

    if (expired > 0) {
      console.warn(`[WorkspaceUploadCleanup] Expired ${expired} stale upload request(s)`);
    }
  },
});
