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
};

/** Non-reactive cache — CommandItem rows must not live in Legend observables. */
const browseRowsByPartitionKey = new Map<string, CommandPaletteRow[]>();

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
  };
}

export function getCommandPaletteBrowseRows(partitionKey: string): CommandPaletteRow[] {
  return browseRowsByPartitionKey.get(partitionKey) ?? [];
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
    browseRowsByPartitionKey.delete(partitionKey);
  }
}

/** Bump generation and return new value for preload guard. */
export function beginCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>
): number {
  const partitionKey = state$.partitionKey.get();
  const next = state$.generation.get() + 1;
  state$.generation.set(next);
  state$.status.set('loading');
  browseRowsByPartitionKey.set(partitionKey, []);
  return next;
}

export function commitCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>,
  generation: number,
  browseRows: CommandPaletteRow[]
): void {
  if (state$.generation.get() !== generation) return;
  browseRowsByPartitionKey.set(state$.partitionKey.get(), browseRows);
  state$.status.set('ready');
}

// fallow-ignore-next-line unused-export
export function abortCommandPalettePreload(
  state$: Observable<CommandPalettePartitionState>,
  generation: number
): void {
  if (state$.generation.get() !== generation) return;
  browseRowsByPartitionKey.set(state$.partitionKey.get(), []);
  state$.status.set('idle');
}

// fallow-ignore-next-line unused-export — consumed by unit tests
export function resetCommandPalettePartitionRegistryForTests(): void {
  registry.clear();
  browseRowsByPartitionKey.clear();
}

// fallow-ignore-next-line unused-export — consumed by unit tests
export function getCommandPalettePartitionForTests(
  chatroomId: string,
  workspaceId: string | null | undefined
): Observable<CommandPalettePartitionState> | undefined {
  return registry.get(makeCommandPalettePartitionKey(chatroomId, workspaceId))?.state$;
}

// fallow-ignore-next-line unused-export — consumed by unit tests
export function getCommandPalettePartitionRefCountForTests(
  chatroomId: string,
  workspaceId: string | null | undefined
): number {
  const entry = registry.get(makeCommandPalettePartitionKey(chatroomId, workspaceId));
  return entry?.refCount ?? 0;
}
