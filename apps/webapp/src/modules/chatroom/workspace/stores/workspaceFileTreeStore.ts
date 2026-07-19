// fallow-ignore-file complexity
import type { FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

const EMPTY_ENTRIES: FileTreeEntry[] = [];

export function toWorkspaceFileTreeKey(machineId: string, workingDir: string): string {
  return `${machineId}::${normalizeWorkspaceWorkingDir(workingDir)}`;
}

type TreeBucket = {
  entries: FileTreeEntry[];
  scannedAt: number | null;
  revision: number | null;
};

export type WorkspaceFileTreeDeltaOperation =
  | {
      operation: 'add' | 'type-change';
      path: string;
      entryType: FileTreeEntry['type'];
      size?: number;
      modifiedAt?: number;
    }
  | { operation: 'remove'; path: string };

export type WorkspaceFileTreeDeltaBatch = {
  baseRevision: number;
  revision: number;
  operations: WorkspaceFileTreeDeltaOperation[];
  scannedAt?: number;
};

export type ApplyWorkspaceFileTreeDeltasResult =
  | { status: 'applied'; revision: number }
  | { status: 'already-applied'; revision: number }
  | { status: 'requires-refresh'; revision: number | null };

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
  scannedAt: number | null,
  revision: number | null = null
): void {
  const existing = buckets.get(workspaceKey);
  if (existing && existing.revision !== null && revision !== null && existing.revision > revision) {
    return;
  }
  if (
    existing &&
    entriesEqual(existing.entries, entries) &&
    existing.scannedAt === scannedAt &&
    existing.revision === revision
  ) {
    return;
  }
  buckets.set(workspaceKey, { entries, scannedAt, revision });
  emit(workspaceKey);
}

/**
 * Applies server-ordered batches atomically. A gap or overlapping batch asks the caller to
 * recover from a fresh checkpoint instead of exposing a partially updated tree.
 */
export function applyWorkspaceFileTreeDeltas(
  workspaceKey: string,
  batches: WorkspaceFileTreeDeltaBatch[]
): ApplyWorkspaceFileTreeDeltasResult {
  const existing = buckets.get(workspaceKey);
  if (!existing || existing.revision === null) {
    return { status: 'requires-refresh', revision: existing?.revision ?? null };
  }

  let revision = existing.revision;
  const pending = batches.filter((batch) => batch.revision > revision);
  if (pending.length === 0) return { status: 'already-applied', revision };

  const entriesByPath = new Map(existing.entries.map((entry) => [entry.path, entry]));
  let scannedAt = existing.scannedAt;

  for (const batch of pending) {
    if (batch.baseRevision !== revision || batch.revision <= batch.baseRevision) {
      return { status: 'requires-refresh', revision: existing.revision };
    }

    for (const operation of batch.operations) {
      if (operation.operation === 'remove') {
        entriesByPath.delete(operation.path);
        continue;
      }

      entriesByPath.set(operation.path, {
        path: operation.path,
        type: operation.entryType,
        ...(operation.size !== undefined ? { size: operation.size } : {}),
        ...(operation.modifiedAt !== undefined ? { modifiedAt: operation.modifiedAt } : {}),
      });
    }
    revision = batch.revision;
    scannedAt = batch.scannedAt ?? scannedAt;
  }

  const entries = [...entriesByPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  buckets.set(workspaceKey, { entries, scannedAt, revision });
  emit(workspaceKey);
  return { status: 'applied', revision };
}

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

export function getWorkspaceFileTreeRevision(workspaceKey: string): number | null {
  return buckets.get(workspaceKey)?.revision ?? null;
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
