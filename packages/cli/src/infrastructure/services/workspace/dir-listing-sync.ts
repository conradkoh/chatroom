import { gzipSync } from 'node:zlib';
// fallow-ignore-file complexity

import { computeDirListingContentHash } from './dir-listing-content-hash.js';
import { listDirectory } from './dir-listing-scanner.js';
import { api } from '../../../api.js';
import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';

const MAX_BATCH_SIZE = 25;
const SCAN_CONCURRENCY = 4;

const lastSyncedContentHash = new Map<string, string>();

function listingCacheKey(workingDir: string, dirPath: string): string {
  return `${workingDir}\0${dirPath}`;
}

type DirListingSyncItem = {
  dirPath: string;
  data: { compression: 'gzip'; content: string };
  dataHash: string;
  scannedAt: number;
  truncated: boolean;
  totalCount: number;
};

async function scanDirListingForSync(
  workingDir: string,
  dirPath: string
): Promise<DirListingSyncItem | null> {
  const listing = await listDirectory(workingDir, dirPath);
  const dataHash = computeDirListingContentHash(listing);
  const cacheKey = listingCacheKey(workingDir, dirPath);
  if (lastSyncedContentHash.get(cacheKey) === dataHash) return null;

  const json = JSON.stringify(listing);
  return {
    dirPath,
    data: { compression: 'gzip' as const, content: gzipSync(Buffer.from(json)).toString('base64') },
    dataHash,
    scannedAt: listing.scannedAt,
    truncated: listing.truncated,
    totalCount: listing.totalCount,
  };
}

async function scanDirListingsWithConcurrency(
  workingDir: string,
  dirPaths: string[]
): Promise<DirListingSyncItem[]> {
  const items: DirListingSyncItem[] = [];
  let index = 0;

  async function worker(): Promise<void> {
    while (index < dirPaths.length) {
      const currentIndex = index;
      index += 1;
      const dirPath = dirPaths[currentIndex];
      if (dirPath === undefined) continue;
      const item = await scanDirListingForSync(workingDir, dirPath);
      if (item) items.push(item);
    }
  }

  const workerCount = Math.min(SCAN_CONCURRENCY, dirPaths.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return items;
}

function markItemsSynced(workingDir: string, items: DirListingSyncItem[]): void {
  for (const item of items) {
    lastSyncedContentHash.set(listingCacheKey(workingDir, item.dirPath), item.dataHash);
  }
}

/** Scan one directory and upsert listing to Convex (dataHash dedup on server). */
export async function syncDirListingToBackend(
  session: DaemonSessionServiceShape,
  workingDir: string,
  dirPath: string
): Promise<void> {
  const item = await scanDirListingForSync(workingDir, dirPath);
  if (!item) return;

  await session.backend.mutation(api.workspaceFiles.syncDirListingV2, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    dirPath: item.dirPath,
    data: item.data,
    dataHash: item.dataHash,
    scannedAt: item.scannedAt,
    truncated: item.truncated,
    totalCount: item.totalCount,
  });

  markItemsSynced(workingDir, [item]);
}

/** Sync one or many dir listings; batches Convex mutations when dirPaths.length > 1. */
export async function syncDirListingsToBackend(
  session: DaemonSessionServiceShape,
  workingDir: string,
  dirPaths: string[]
): Promise<void> {
  const unique = [...new Set(dirPaths)];
  if (unique.length === 0) return;

  if (unique.length === 1) {
    const dirPath = unique[0];
    if (dirPath !== undefined) {
      await syncDirListingToBackend(session, workingDir, dirPath);
    }
    return;
  }

  const items = await scanDirListingsWithConcurrency(workingDir, unique);
  if (items.length === 0) return;

  for (let i = 0; i < items.length; i += MAX_BATCH_SIZE) {
    const chunk = items.slice(i, i + MAX_BATCH_SIZE);
    await session.backend.mutation(api.workspaceFiles.syncDirListingV2Batch, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir,
      items: chunk,
    });
    markItemsSynced(workingDir, chunk);
  }
}

/** For tests only — clear in-memory dedup cache. */
// fallow-ignore-next-line unused-export
export function resetDirListingSyncCacheForTests(): void {
  lastSyncedContentHash.clear();
}
