/**
 * Local ref-count for file-tree UI watches (per browser tab).
 * Convex watch count is adjusted only on 0→1 and 1→0 transitions.
 */

import { toWorkspaceFileTreeKey } from '../stores/workspaceFileTreeStore';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

type AdjustWatch = (args: {
  machineId: string;
  workingDir: string;
  delta: 1 | -1;
}) => void | Promise<unknown>;

type RenewLease = (args: { machineId: string; workingDir: string }) => void | Promise<unknown>;

function fireAdjustWatch(
  adjustWatch: AdjustWatch,
  args: {
    machineId: string;
    workingDir: string;
    delta: 1 | -1;
  }
): void {
  void (async () => {
    try {
      await adjustWatch(args);
    } catch {
      // ignore watch sync errors — UI can retry on next acquire
    }
  })();
}

const localRefCounts = new Map<string, number>();
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
export function __resetWorkspaceFileTreeWatchCoordinatorForTests(): void {
  localRefCounts.clear();
  notify();
}

export function subscribeFileTreeWatch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isFileTreeWatchActive(machineId: string, workingDir: string): boolean {
  const key = workspaceKey(machineId, workingDir);
  return (localRefCounts.get(key) ?? 0) > 0;
}

export function acquireFileTreeWatch(
  machineId: string,
  workingDir: string,
  adjustWatch: AdjustWatch
): void {
  const normalized = normalizeWorkspaceWorkingDir(workingDir);
  const key = workspaceKey(machineId, normalized);
  const count = localRefCounts.get(key) ?? 0;
  localRefCounts.set(key, count + 1);
  if (count === 0) {
    notify();
    fireAdjustWatch(adjustWatch, { machineId, workingDir: normalized, delta: 1 });
  }
}

export function releaseFileTreeWatch(
  machineId: string,
  workingDir: string,
  adjustWatch: AdjustWatch
): void {
  const normalized = normalizeWorkspaceWorkingDir(workingDir);
  const key = workspaceKey(machineId, normalized);
  const count = localRefCounts.get(key) ?? 0;
  if (count <= 0) return;

  const next = count - 1;
  if (next === 0) {
    localRefCounts.delete(key);
    notify();
    fireAdjustWatch(adjustWatch, { machineId, workingDir: normalized, delta: -1 });
  } else {
    localRefCounts.set(key, next);
    notify();
  }
}

/** Fire-and-forget lease renewal; a later interval retries transient failures. */
export function renewFileTreeWatchLease(
  machineId: string,
  workingDir: string,
  renew: RenewLease
): void {
  void Promise.resolve(
    renew({
      machineId,
      workingDir: normalizeWorkspaceWorkingDir(workingDir),
    })
  ).catch(() => {});
}
