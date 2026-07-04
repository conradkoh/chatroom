import { gzipSync } from 'node:zlib';

import { computeDirListingContentHash } from './dir-listing-content-hash.js';
import { listDirectory } from './dir-listing-scanner.js';
import { api } from '../../../api.js';
import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';

const lastSyncedContentHash = new Map<string, string>();

function listingCacheKey(workingDir: string, dirPath: string): string {
  return `${workingDir}\0${dirPath}`;
}

/** Scan one directory and upsert listing to Convex (dataHash dedup on server). */
export async function syncDirListingToBackend(
  session: DaemonSessionServiceShape,
  workingDir: string,
  dirPath: string
): Promise<void> {
  const listing = await listDirectory(workingDir, dirPath);
  const dataHash = computeDirListingContentHash(listing);
  const cacheKey = listingCacheKey(workingDir, dirPath);

  if (lastSyncedContentHash.get(cacheKey) === dataHash) {
    return;
  }

  const json = JSON.stringify(listing);
  const compressed = gzipSync(Buffer.from(json)).toString('base64');

  await session.backend.mutation(api.workspaceFiles.syncDirListingV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    dirPath,
    data: { compression: 'gzip' as const, content: compressed },
    dataHash,
    scannedAt: listing.scannedAt,
    truncated: listing.truncated,
    totalCount: listing.totalCount,
  });

  lastSyncedContentHash.set(cacheKey, dataHash);
}

/** For tests only — clear in-memory dedup cache. */
// fallow-ignore-next-line unused-export
export function resetDirListingSyncCacheForTests(): void {
  lastSyncedContentHash.clear();
}
