// fallow-ignore-file complexity

import type { FileTreeCheckpointTransport } from './transport/checkpoint';
import type { ShardedSnapshotManifest } from './transport/sharded-snapshot';
import type { FileTreeSnapshotStrategyId } from './types';

export type FileTreeHydrationMode = FileTreeSnapshotStrategyId | 'pending' | 'none';
export type ShardedSnapshotManifestView = Pick<ShardedSnapshotManifest, 'complete'> | null;

export function resolveFileTreeHydrationMode(input: {
  checkpoint: FileTreeCheckpointTransport | null | undefined;
  manifest: ShardedSnapshotManifestView | undefined;
}): FileTreeHydrationMode {
  const { checkpoint, manifest } = input;
  if (manifest?.complete === true && (checkpoint === null || checkpoint?.strategyId === 'sharded'))
    return 'sharded';
  if (
    checkpoint !== undefined &&
    (checkpoint?.strategyId === 'blob' || (checkpoint === null && manifest === null))
  )
    return 'blob';
  if (manifest?.complete === false) return 'pending';
  return 'none';
}

// fallow-ignore-next-line unused-export
export function isHydratableFileTreeMode(
  mode: FileTreeHydrationMode
): mode is FileTreeSnapshotStrategyId {
  return mode === 'blob' || mode === 'sharded';
}
