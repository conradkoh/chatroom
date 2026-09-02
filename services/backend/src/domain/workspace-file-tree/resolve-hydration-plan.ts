// fallow-ignore-file complexity
import type { FileTreeCheckpointTransport } from './transport/checkpoint';
import type { ShardedSnapshotManifest } from './transport/sharded-snapshot';

export type ShardedSnapshotManifestView = Pick<
  ShardedSnapshotManifest,
  'complete' | 'syncGeneration'
> | null;

export type BlobHydrationStatus = 'skip' | 'queries-pending' | 'decompressing' | 'ready';
export type ShardedHydrationStatus =
  'skip' | 'queries-pending' | 'decompressing' | 'decompression-failed' | 'ready';

export type FileTreeHydrationPlan =
  | { kind: 'awaiting-queries' }
  | { kind: 'hydrate-blob'; loading: boolean }
  | { kind: 'hydrate-sharded'; syncGeneration: string; loading: boolean }
  | {
      kind: 'recover';
      reason: 'incomplete-manifest' | 'shard-decompression-failed';
      recoveryKey: string;
    }
  | { kind: 'idle' };

export function isFileTreeHydrationLoading(plan: FileTreeHydrationPlan): boolean {
  if (plan.kind === 'awaiting-queries') return true;
  if (plan.kind === 'hydrate-blob') return plan.loading;
  if (plan.kind === 'hydrate-sharded') return plan.loading;
  if (plan.kind === 'recover') return true;
  return false;
}

export function resolveFileTreeHydrationPlan(input: {
  checkpoint: FileTreeCheckpointTransport | null | undefined;
  manifest: ShardedSnapshotManifestView | undefined;
  blobStatus: BlobHydrationStatus;
  shardedStatus: ShardedHydrationStatus;
  shardsPayloadKey?: string | undefined;
}): FileTreeHydrationPlan {
  const { checkpoint, manifest, blobStatus, shardedStatus, shardsPayloadKey } = input;

  if (checkpoint === undefined || manifest === undefined) {
    return { kind: 'awaiting-queries' };
  }

  if (manifest?.complete === false) {
    return {
      kind: 'recover',
      reason: 'incomplete-manifest',
      recoveryKey: manifest.syncGeneration,
    };
  }

  const useSharded =
    manifest?.complete === true && (checkpoint === null || checkpoint.strategyId === 'sharded');
  const useBlob =
    !useSharded &&
    (checkpoint?.strategyId === 'blob' || (checkpoint === null && manifest === null));

  if (useSharded && manifest) {
    const syncGeneration = manifest.syncGeneration;
    if (shardedStatus === 'decompression-failed') {
      return {
        kind: 'recover',
        reason: 'shard-decompression-failed',
        recoveryKey: `${syncGeneration}:${shardsPayloadKey ?? 'unknown'}`,
      };
    }
    const loading = shardedStatus === 'queries-pending' || shardedStatus === 'decompressing';
    return {
      kind: 'hydrate-sharded',
      syncGeneration,
      loading,
    };
  }

  if (useBlob) {
    const loading = blobStatus === 'queries-pending' || blobStatus === 'decompressing';
    return { kind: 'hydrate-blob', loading };
  }

  return { kind: 'idle' };
}
