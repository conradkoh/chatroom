import type { DirListingEntry } from '@workspace/backend/src/domain/entities/workspace-files';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';
import type { FileEntry } from '@/modules/chatroom/components/FileSelector/useFileSelector';

const EMPTY_FLAT: FileEntry[] = [];

export function toTrackedWorkspaceKey(machineId: string, workingDir: string): string {
  return `${machineId}::${normalizeWorkspaceWorkingDir(workingDir)}`;
}

function dirListingToFileEntries(entries: DirListingEntry[]): FileEntry[] {
  return entries.map((e) => ({
    path: e.path,
    type: e.type,
    ...(e.size !== undefined ? { size: e.size } : {}),
  }));
}

/** Merge entry groups; first occurrence of path+type wins. */
function mergeTrackedFileEntries(...groups: FileEntry[][]): FileEntry[] {
  const seen = new Set<string>();
  const out: FileEntry[] = [];
  for (const group of groups) {
    for (const entry of group) {
      const key = `${entry.type}\0${entry.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

function fileEntriesEqual(a: FileEntry[], b: FileEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, i) => entry.path === b[i]?.path && entry.type === b[i]?.type)
  );
}

type WorkspaceBucket = {
  /** dirPath → entries from that listing ('' = root) */
  byDir: Map<string, FileEntry[]>;
  cachedFlat: FileEntry[] | null;
};

const buckets = new Map<string, WorkspaceBucket>();
const listeners = new Map<string, Set<() => void>>();

function getBucket(workspaceKey: string): WorkspaceBucket {
  let bucket = buckets.get(workspaceKey);
  if (!bucket) {
    bucket = { byDir: new Map(), cachedFlat: null };
    buckets.set(workspaceKey, bucket);
  }
  return bucket;
}

function emit(workspaceKey: string): void {
  const set = listeners.get(workspaceKey);
  if (!set) return;
  for (const listener of set) listener();
}

export function upsertTrackedDirListing(
  workspaceKey: string,
  dirPath: string,
  entries: DirListingEntry[]
): void {
  const bucket = getBucket(workspaceKey);
  const next = dirListingToFileEntries(entries);
  const existing = bucket.byDir.get(dirPath);
  if (existing && fileEntriesEqual(existing, next)) return;
  bucket.byDir.set(dirPath, next);
  bucket.cachedFlat = null;
  emit(workspaceKey);
}

export function clearTrackedWorkspace(workspaceKey: string): void {
  buckets.delete(workspaceKey);
  emit(workspaceKey);
}

export function getTrackedFileEntries(workspaceKey: string): FileEntry[] {
  const bucket = buckets.get(workspaceKey);
  if (!bucket) return EMPTY_FLAT;
  if (bucket.cachedFlat !== null) return bucket.cachedFlat;
  bucket.cachedFlat = mergeTrackedFileEntries(...bucket.byDir.values());
  return bucket.cachedFlat;
}

export function subscribeTrackedWorkspace(workspaceKey: string, listener: () => void): () => void {
  let set = listeners.get(workspaceKey);
  if (!set) {
    set = new Set();
    listeners.set(workspaceKey, set);
  }
  const listenerSet = set;
  listenerSet.add(listener);
  return () => {
    listenerSet.delete(listener);
    if (listenerSet.size === 0) listeners.delete(workspaceKey);
  };
}

/** Test-only reset */
// fallow-ignore-next-line unused-export
export function __resetTrackedWorkspaceFilesStoreForTests(): void {
  buckets.clear();
  listeners.clear();
}
