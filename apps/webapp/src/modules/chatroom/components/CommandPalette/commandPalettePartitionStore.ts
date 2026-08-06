// fallow-ignore-file unused-file
import { observable, type Observable } from '@legendapp/state';

import {
  makeCommandPalettePartitionKey,
  NO_WORKSPACE_SENTINEL,
} from './commandPalettePartitionKey';
import type { CommandPaletteRow } from './commandPaletteRows';

export type CommandPalettePartitionStatus = 'idle' | 'loading' | 'ready';

export type CommandPalettePartitionState = {
  partitionKey: string;
  chatroomId: string;
  workspaceId: string;
  status: CommandPalettePartitionStatus;
  /** Incremented on each preload start — guards against stale async writes. */
  generation: number;
  browseRows: CommandPaletteRow[];
};

type PartitionEntry = {
  state$: Observable<CommandPalettePartitionState>;
  refCount: number;
};

const registry = new Map<string, PartitionEntry>();

function createInitialState(
  partitionKey: string,
  chatroomId: string,
  workspaceId: string
): CommandPalettePartitionState {
  return {
    partitionKey,
    chatroomId,
    workspaceId,
    status: 'idle',
    generation: 0,
    browseRows: [],
  };
}

export function acquireCommandPalettePartition(
  chatroomId: string,
  workspaceId: string | null | undefined
): Observable<CommandPalettePartitionState> {
  const partitionKey = makeCommandPalettePartitionKey(chatroomId, workspaceId);
  const ws = workspaceId?.trim() || NO_WORKSPACE_SENTINEL;
  let entry = registry.get(partitionKey);
  if (!entry) {
    entry = {
      state$: observable(createInitialState(partitionKey, chatroomId, ws)),
      refCount: 0,
    };
    registry.set(partitionKey, entry);
  }
  entry.refCount += 1;
  return entry.state$;
}

export function releaseCommandPalettePartition(
  chatroomId: string,
  workspaceId: string | null | undefined
): void {
  const partitionKey = makeCommandPalettePartitionKey(chatroomId, workspaceId);
  const entry = registry.get(partitionKey);
  if (!entry) return;
  entry.refCount -= 1;
  if (entry.refCount <= 0) {
    registry.delete(partitionKey);
  }
}

/** Bump generation and return new value for preload guard. */
export function beginCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>
): number {
  const next = state$.generation.get() + 1;
  state$.generation.set(next);
  state$.status.set('loading');
  state$.browseRows.set([]);
  return next;
}

export function commitCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>,
  generation: number,
  browseRows: CommandPaletteRow[]
): void {
  if (state$.generation.get() !== generation) return;
  state$.browseRows.set(browseRows);
  state$.status.set('ready');
}

export function abortCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>,
  generation: number
): void {
  if (state$.generation.get() !== generation) return;
  state$.status.set('idle');
}

export function resetCommandPalettePartitionRegistryForTests(): void {
  registry.clear();
}

export function getCommandPalettePartitionForTests(
  chatroomId: string,
  workspaceId: string | null | undefined
): Observable<CommandPalettePartitionState> | undefined {
  return registry.get(makeCommandPalettePartitionKey(chatroomId, workspaceId))?.state$;
}

export function getCommandPalettePartitionRefCountForTests(
  chatroomId: string,
  workspaceId: string | null | undefined
): number {
  const entry = registry.get(makeCommandPalettePartitionKey(chatroomId, workspaceId));
  return entry?.refCount ?? 0;
}
