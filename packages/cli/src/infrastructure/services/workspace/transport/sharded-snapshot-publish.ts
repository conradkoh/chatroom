import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';
import {
  toLegacyManifestSyncArgs,
  toLegacyShardBatchItem,
  type ShardedSnapshotManifest,
  type ShardedSnapshotShard,
} from '@workspace/backend/src/domain/workspace-file-tree/transport/sharded-snapshot.js';
import type { FileTreeSnapshotRef } from '@workspace/backend/src/domain/workspace-file-tree/types.js';

import { api } from '../../../../api.js';
import type { DaemonSessionServiceShape } from '../../../../daemon/entry/daemon-services.js';
import { MAX_SHARD_BATCH_SIZE, partitionFileTree } from '../file-tree-partition.js';

export async function publishShardedSnapshot(
  session: DaemonSessionServiceShape,
  workingDir: string,
  tree: FileTree,
  syncGeneration: string
): Promise<FileTreeSnapshotRef> {
  const shards = partitionFileTree(tree);
  const shardIds: string[] = [];

  for (let i = 0; i < shards.length; i += MAX_SHARD_BATCH_SIZE) {
    const batch = shards.slice(i, i + MAX_SHARD_BATCH_SIZE);
    const items: ShardedSnapshotShard[] = batch.map((s) => ({
      shardId: s.shardId,
      data: s.data,
      dataHash: s.dataHash,
      scannedAt: tree.scannedAt,
      entryCount: s.entryCount,
    }));
    await session.backend.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir,
      syncGeneration,
      items: items.map(toLegacyShardBatchItem),
    });
    for (const s of batch) shardIds.push(s.shardId);
  }

  const manifest: ShardedSnapshotManifest = {
    syncGeneration,
    shardIds,
    totalEntryCount: tree.entries.length,
    complete: true,
    scannedAt: tree.scannedAt,
  };

  await session.backend.mutation(api.workspaceFiles.syncFileTreeManifestV3, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    ...toLegacyManifestSyncArgs(manifest),
  });

  return {
    strategyId: 'sharded',
    snapshotId: syncGeneration,
    scannedAt: tree.scannedAt,
    entryCount: tree.entries.length,
  };
}
