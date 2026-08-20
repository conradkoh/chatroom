import type { FileTreeSnapshotStrategyId } from '../../../src/domain/workspace-file-tree/types';
// fallow-ignore-file complexity
import type { MutationCtx } from '../../_generated/server';
import * as blobSnapshots from '../repositories/blobSnapshotRepository';
import * as checkpoints from '../repositories/checkpointRepository';
import * as deltas from '../repositories/deltaRepository';
import * as shardedSnapshots from '../repositories/shardedSnapshotRepository';
import type { PublishCheckpointResult } from '../types';

export async function publishFileTreeCheckpoint(
  ctx: MutationCtx,
  args: {
    machineId: string;
    workingDir: string;
    revision: number;
    strategyId: FileTreeSnapshotStrategyId;
    snapshotId: string;
  }
): Promise<PublishCheckpointResult> {
  const current = await deltas.getCurrentRevision(ctx, args.machineId, args.workingDir);
  if (args.revision !== current && args.revision !== current + 1)
    return { status: 'resync-required', expectedRevision: current };
  const exists =
    args.strategyId === 'blob'
      ? await blobSnapshots.verifyBlobSnapshotExists(
          ctx,
          args.machineId,
          args.workingDir,
          args.snapshotId
        )
      : await shardedSnapshots.verifyShardedSnapshotExists(
          ctx,
          args.machineId,
          args.workingDir,
          args.snapshotId
        );
  if (!exists) return { status: 'snapshot-missing' };
  const old = await checkpoints.findCheckpoint(ctx, args.machineId, args.workingDir);
  if (old && args.revision < old.revision)
    return { status: 'resync-required', expectedRevision: current };
  const unchanged =
    old?.revision === args.revision &&
    old.strategyId === args.strategyId &&
    old.snapshotId === args.snapshotId;
  await checkpoints.upsertCheckpoint(ctx, { ...args, publishedAt: Date.now() });
  const prune = await deltas.deleteDeltasUpToRevision(
    ctx,
    args.machineId,
    args.workingDir,
    args.revision
  );
  return {
    status: unchanged ? 'unchanged' : 'published',
    revision: args.revision,
    prunedDeltaCount: prune.prunedDeltaCount,
    pruneComplete: prune.pruneComplete,
  };
}
