// fallow-ignore-file code-duplication complexity

/**
 * Local ref-count for file-tree delta Convex subscriptions (per browser tab).
 * Exactly one hook instance per workspaceKey runs getFileTreeDeltas at a time.
 */

import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export type DeltaSyncOwnerId = symbol;

const localRefCounts = new Map<string, number>();
/** Registration order per workspaceKey — first registered id is owner. */
const ownerQueues = new Map<string, DeltaSyncOwnerId[]>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

function workspaceKey(machineId: string, workingDir: string): string {
  return toWorkspaceFileTreeKey(machineId, normalizeWorkspaceWorkingDir(workingDir));
}

// fallow-ignore-next-line unused-export
export function __resetWorkspaceFileTreeDeltaSyncCoordinatorForTests(): void {
  localRefCounts.clear();
  ownerQueues.clear();
  notify();
}

export function subscribeFileTreeDeltaSync(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isFileTreeDeltaSyncOwner(
  machineId: string,
  workingDir: string,
  ownerId: DeltaSyncOwnerId
): boolean {
  const key = workspaceKey(machineId, workingDir);
  const queue = ownerQueues.get(key);
  return queue !== undefined && queue.length > 0 && queue[0] === ownerId;
}

// fallow-ignore-next-line unused-export
export function isFileTreeDeltaSyncActive(machineId: string, workingDir: string): boolean {
  const key = workspaceKey(machineId, workingDir);
  return (localRefCounts.get(key) ?? 0) > 0;
}

export function acquireFileTreeDeltaSync(
  machineId: string,
  workingDir: string,
  ownerId: DeltaSyncOwnerId
): void {
  const key = workspaceKey(machineId, workingDir);
  const count = localRefCounts.get(key) ?? 0;
  localRefCounts.set(key, count + 1);

  const queue = ownerQueues.get(key) ?? [];
  queue.push(ownerId);
  ownerQueues.set(key, queue);

  notify();
}

export function releaseFileTreeDeltaSync(
  machineId: string,
  workingDir: string,
  ownerId: DeltaSyncOwnerId
): void {
  const key = workspaceKey(machineId, workingDir);
  const count = localRefCounts.get(key) ?? 0;
  if (count <= 0) return;

  const next = count - 1;
  if (next === 0) {
    localRefCounts.delete(key);
    ownerQueues.delete(key);
  } else {
    localRefCounts.set(key, next);
    const queue = ownerQueues.get(key);
    if (queue) {
      const idx = queue.indexOf(ownerId);
      if (idx >= 0) queue.splice(idx, 1);
      if (queue.length === 0) ownerQueues.delete(key);
    }
  }

  notify();
}
