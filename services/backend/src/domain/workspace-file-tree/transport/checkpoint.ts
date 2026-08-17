import type { FileTreeSnapshotStrategyId } from '../types';

export type FileTreeCheckpointTransport = {
  revision: number;
  strategyId: FileTreeSnapshotStrategyId;
  snapshotId: string;
  publishedAt: number;
};
