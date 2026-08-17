import type { FileTreeSnapshotStrategyId } from '../../src/domain/workspace-file-tree/types';

export type FileTreeCheckpointRow = {
  machineId: string;
  workingDir: string;
  revision: number;
  strategyId: FileTreeSnapshotStrategyId;
  snapshotId: string;
  publishedAt: number;
};
export type PublishCheckpointResult =
  | { status: 'published' | 'unchanged'; revision: number; prunedDeltaCount: number }
  | { status: 'resync-required'; expectedRevision: number }
  | { status: 'snapshot-missing' };
