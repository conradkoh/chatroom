/**
 * File Write Request Priority — ordering for daemon drain batches.
 *
 * Fast file operations (delete/mkdir/rename) are processed before slower
 * writes so user-visible mutations are not blocked behind storage uploads.
 */

import type { PendingFileWriteRequest } from './file-write-fulfillment.js';

const FAST_OPERATIONS = new Set<PendingFileWriteRequest['operation']>([
  'delete',
  'mkdir',
  'rename',
]);

/** Lower = processed first. Fast ops first, then inline writes, then storage-backed uploads last. */
// fallow-ignore-next-line unused-export
export function compareFileWriteRequestPriority(
  a: PendingFileWriteRequest,
  b: PendingFileWriteRequest
): number {
  const rank = (r: PendingFileWriteRequest): number => {
    if (FAST_OPERATIONS.has(r.operation)) return 0;
    if (r.storageId) return 2;
    return 1;
  };
  const diff = rank(a) - rank(b);
  if (diff !== 0) return diff;
  // FIFO within same priority (stable tiebreaker when no requestedAt on type)
  return a._id.localeCompare(b._id);
}

export function sortPendingFileWriteRequests(
  requests: PendingFileWriteRequest[]
): PendingFileWriteRequest[] {
  return [...requests].sort(compareFileWriteRequestPriority);
}
