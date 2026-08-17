// fallow-ignore-file unused-export
import type { FileTreeCompressedPayload } from './shared';

export type ShardedSnapshotShard = {
  shardId: string;
  data: FileTreeCompressedPayload;
  dataHash: string;
  scannedAt: number;
  entryCount: number;
};
export type ShardedSnapshotManifest = {
  syncGeneration: string;
  shardIds: string[];
  totalEntryCount: number;
  complete: boolean;
  scannedAt: number;
};
export function toLegacyShardBatchItem(shard: ShardedSnapshotShard) {
  return { ...shard };
}
export function toLegacyManifestSyncArgs(manifest: ShardedSnapshotManifest) {
  return { ...manifest };
}
export function fromLegacyManifestReadResult(raw: ShardedSnapshotManifest | null) {
  return raw;
}
export function fromLegacyShardReadResults(raw: ShardedSnapshotShard[] | null) {
  return raw;
}
