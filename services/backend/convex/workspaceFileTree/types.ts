import type { FileTreeSnapshotStrategyId } from '../../src/domain/workspace-file-tree/types';
import type {
  CompactFileTreeDeltaOp,
  expandFileTreeDeltaOperations,
} from '../lib/fileTreeDeltaOps';

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

export type ApplyDeltaResult =
  | { status: 'applied'; revision: number }
  | { status: 'duplicate'; revision: number }
  | { status: 'resync-required'; expectedRevision: number };

export type GetDeltasResult =
  | { status: 'checkpoint-required'; checkpointRevision: number; currentRevision: number }
  | { status: 'resync-required'; expectedRevision: number }
  | {
      status: 'ok';
      deltas: {
        baseRevision: number;
        revision: number;
        operations: ReturnType<typeof expandFileTreeDeltaOperations>;
      }[];
      hasMore?: true;
    };

export type CompactDeltaOperations = CompactFileTreeDeltaOp[];
