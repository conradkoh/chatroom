import { createHash } from 'node:crypto';

import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files.js';

/** Hash visible listing payload only — excludes scan metadata like scannedAt. */
export function computeDirListingContentHash(listing: {
  entries: DirListingEntry[];
  truncated: boolean;
  totalCount: number;
}): string {
  const payload = {
    entries: listing.entries,
    truncated: listing.truncated,
    totalCount: listing.totalCount,
  };
  return createHash('md5').update(JSON.stringify(payload)).digest('hex');
}
