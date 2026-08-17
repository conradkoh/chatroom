import { strategyIdToSnapshotKind } from '../../../src/domain/workspace-file-tree/types';
import type { QueryCtx } from '../../_generated/server';
import * as checkpoints from '../repositories/checkpointRepository';

export async function getFileTreeCheckpointForApi(
  ctx: QueryCtx,
  machineId: string,
  workingDir: string
) {
  const row = await checkpoints.findCheckpoint(ctx, machineId, workingDir);
  return row
    ? {
        revision: row.revision,
        snapshotKind: strategyIdToSnapshotKind(row.strategyId),
        snapshotId: row.snapshotId,
        publishedAt: row.publishedAt,
      }
    : null;
}
