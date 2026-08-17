import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';

import { partitionFileTree } from './file-tree-partition.js';
import { publishShardedSnapshot } from './transport/sharded-snapshot-publish.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';

export async function uploadFileTreeV3(
  session: DaemonSessionServiceShape,
  workingDir: string,
  tree: FileTree,
  syncGeneration: string
): Promise<{ shardIds: string[]; totalEntryCount: number }> {
  const ref = await publishShardedSnapshot(session, workingDir, tree, syncGeneration);
  const shardIds = partitionFileTree(tree).map((s) => s.shardId);
  return { shardIds, totalEntryCount: ref.entryCount };
}
// fallow-ignore-file unused-file
