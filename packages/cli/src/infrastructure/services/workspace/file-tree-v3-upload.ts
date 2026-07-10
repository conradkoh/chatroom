import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

import { MAX_SHARD_BATCH_SIZE, partitionFileTree } from './file-tree-partition.js';
import { api } from '../../../api.js';
import type { DaemonSessionServiceShape } from '../../../commands/machine/daemon-start/daemon-services.js';

export async function uploadFileTreeV3(
  session: DaemonSessionServiceShape,
  workingDir: string,
  tree: FileTree,
  syncGeneration: string
): Promise<{ shardIds: string[]; totalEntryCount: number }> {
  const shards = partitionFileTree(tree);
  const shardIds: string[] = [];

  for (let i = 0; i < shards.length; i += MAX_SHARD_BATCH_SIZE) {
    const batch = shards.slice(i, i + MAX_SHARD_BATCH_SIZE);
    await session.backend.mutation(api.workspaceFiles.syncFileTreeShardV3Batch, {
      sessionId: session.sessionId,
      machineId: session.machineId,
      workingDir,
      syncGeneration,
      items: batch.map((s) => ({
        shardId: s.shardId,
        data: s.data,
        dataHash: s.dataHash,
        scannedAt: tree.scannedAt,
        entryCount: s.entryCount,
      })),
    });
    for (const s of batch) shardIds.push(s.shardId);
  }

  await session.backend.mutation(api.workspaceFiles.syncFileTreeManifestV3, {
    sessionId: session.sessionId,
    machineId: session.machineId,
    workingDir,
    syncGeneration,
    shardIds,
    totalEntryCount: tree.entries.length,
    complete: true,
    scannedAt: tree.scannedAt,
  });

  return { shardIds, totalEntryCount: tree.entries.length };
}
