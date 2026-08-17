// fallow-ignore-file complexity

import { snapshotKindToStrategyId, type FileTreeSnapshotStrategyId } from './types';

export type FileTreeHydrationMode = FileTreeSnapshotStrategyId | 'pending' | 'none';
export type FileTreeCheckpointView = { snapshotKind: 'v2' | 'v3' } | null;
export type FileTreeManifestView = { complete: boolean } | null;

export function resolveFileTreeHydrationMode(input: {
  checkpoint: FileTreeCheckpointView | undefined;
  manifest: FileTreeManifestView | undefined;
}): FileTreeHydrationMode {
  const { checkpoint, manifest } = input;
  if (manifest?.complete === true && (checkpoint === null || checkpoint?.snapshotKind === 'v3'))
    return 'sharded';
  if (
    checkpoint !== undefined &&
    (checkpoint?.snapshotKind === 'v2' || (checkpoint === null && manifest === null))
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

// fallow-ignore-next-line unused-export
export { snapshotKindToStrategyId };
