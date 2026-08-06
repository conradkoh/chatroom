import { observable, type Observable } from '@legendapp/state';

import { makeFileSelectorPartitionKey, NO_WORKSPACE_SENTINEL } from './fileSelectorPartitionKey';
import type { FileEntry } from './useFileSelector';

import { normalizeWorkspaceWorkingDir } from '@/lib/workspaceIdentifier';

export type FileSelectorPartitionStatus = 'idle' | 'loading' | 'ready';

export type FileSelectorPartitionState = {
  partitionKey: string;
  chatroomId: string;
  machineId: string;
  workingDir: string;
  status: FileSelectorPartitionStatus;
  /** Incremented on each preload start — guards against stale async writes. */
  generation: number;
};

/** Non-reactive cache — FileEntry rows must not live in Legend observables. */
const preloadFilesByPartitionKey = new Map<string, FileEntry[]>();

type PartitionEntry = {
  state$: Observable<FileSelectorPartitionState>;
  refCount: number;
};

const registry = new Map<string, PartitionEntry>();

function createInitialState(
  partitionKey: string,
  chatroomId: string,
  machineId: string,
  workingDir: string
): FileSelectorPartitionState {
  return {
    partitionKey,
    chatroomId,
    machineId,
    workingDir,
    status: 'idle',
    generation: 0,
  };
}

export function getFileSelectorPreloadFiles(partitionKey: string): FileEntry[] {
  return preloadFilesByPartitionKey.get(partitionKey) ?? [];
}

export function acquireFileSelectorPartition(
  chatroomId: string,
  machineId: string | null | undefined,
  workingDir: string | null | undefined
): Observable<FileSelectorPartitionState> {
  const partitionKey = makeFileSelectorPartitionKey(chatroomId, machineId, workingDir);
  const mid = machineId?.trim() || NO_WORKSPACE_SENTINEL;
  const wd = workingDir?.trim() ? normalizeWorkspaceWorkingDir(workingDir) : NO_WORKSPACE_SENTINEL;
  let entry = registry.get(partitionKey);
  if (!entry) {
    entry = {
      state$: observable(createInitialState(partitionKey, chatroomId, mid, wd)),
      refCount: 0,
    };
    registry.set(partitionKey, entry);
  }
  entry.refCount += 1;
  return entry.state$;
}

export function releaseFileSelectorPartition(
  chatroomId: string,
  machineId: string | null | undefined,
  workingDir: string | null | undefined
): void {
  const partitionKey = makeFileSelectorPartitionKey(chatroomId, machineId, workingDir);
  const entry = registry.get(partitionKey);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    registry.delete(partitionKey);
    preloadFilesByPartitionKey.delete(partitionKey);
  }
}

/** Bump generation and return new value for preload guard. */
export function beginFileSelectorPreload(state$: Observable<FileSelectorPartitionState>): number {
  const partitionKey = state$.partitionKey.get();
  const next = state$.generation.get() + 1;
  state$.generation.set(next);
  state$.status.set('loading');
  preloadFilesByPartitionKey.set(partitionKey, []);
  return next;
}

export function commitFileSelectorPreload(
  state$: Observable<FileSelectorPartitionState>,
  generation: number,
  files: FileEntry[]
): void {
  if (state$.generation.get() !== generation) return;
  preloadFilesByPartitionKey.set(state$.partitionKey.get(), files);
  state$.status.set('ready');
}

// fallow-ignore-next-line unused-export
export function abortFileSelectorPreload(
  state$: Observable<FileSelectorPartitionState>,
  generation: number
): void {
  if (state$.generation.get() !== generation) return;
  preloadFilesByPartitionKey.set(state$.partitionKey.get(), []);
  state$.status.set('idle');
}

// fallow-ignore-next-line unused-export
export function resetFileSelectorPartitionRegistryForTests(): void {
  registry.clear();
  preloadFilesByPartitionKey.clear();
}

// fallow-ignore-next-line unused-export
export function getFileSelectorPartitionForTests(
  chatroomId: string,
  machineId: string | null | undefined,
  workingDir: string | null | undefined
): Observable<FileSelectorPartitionState> | undefined {
  return registry.get(makeFileSelectorPartitionKey(chatroomId, machineId, workingDir))?.state$;
}

// fallow-ignore-next-line unused-export
export function getFileSelectorPartitionRefCountForTests(
  chatroomId: string,
  machineId: string | null | undefined,
  workingDir: string | null | undefined
): number {
  const entry = registry.get(makeFileSelectorPartitionKey(chatroomId, machineId, workingDir));
  return entry?.refCount ?? 0;
}
