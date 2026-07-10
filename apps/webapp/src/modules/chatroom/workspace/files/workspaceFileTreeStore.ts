import type { FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

const EMPTY_ENTRIES: FileTreeEntry[] = [];

export function toWorkspaceFileTreeKey(machineId: string, workingDir: string): string {
  return `${machineId}::${normalizeWorkspaceWorkingDir(workingDir)}`;
}

type TreeBucket = {
  entries: FileTreeEntry[];
  scannedAt: number | null;
};

const buckets = new Map<string, TreeBucket>();
const listeners = new Map<string, Set<() => void>>();

function entriesEqual(a: FileTreeEntry[], b: FileTreeEntry[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function emit(workspaceKey: string): void {
  const set = listeners.get(workspaceKey);
  if (!set) return;
  for (const listener of set) listener();
}

export function upsertWorkspaceFileTree(
  workspaceKey: string,
  entries: FileTreeEntry[],
  scannedAt: number | null
): void {
  const existing = buckets.get(workspaceKey);
  if (existing && entriesEqual(existing.entries, entries) && existing.scannedAt === scannedAt) {
    return;
  }
  buckets.set(workspaceKey, { entries, scannedAt });
  emit(workspaceKey);
}

// fallow-ignore-next-line unused-export
export function clearWorkspaceFileTree(workspaceKey: string): void {
  if (!buckets.has(workspaceKey)) return;
  buckets.delete(workspaceKey);
  emit(workspaceKey);
}

export function getWorkspaceFileTreeEntries(workspaceKey: string): FileTreeEntry[] {
  return buckets.get(workspaceKey)?.entries ?? EMPTY_ENTRIES;
}

export function getWorkspaceFileTreeScannedAt(workspaceKey: string): number | null {
  return buckets.get(workspaceKey)?.scannedAt ?? null;
}

// fallow-ignore-next-line code-duplication
export function subscribeWorkspaceFileTree(workspaceKey: string, listener: () => void): () => void {
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
export function __resetWorkspaceFileTreeStoreForTests(): void {
  buckets.clear();
  listeners.clear();
}
