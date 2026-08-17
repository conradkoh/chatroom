import {
  snapshotKindToStrategyId,
  strategyIdToSnapshotKind,
  type FileTreeSnapshotStrategyId,
} from '../types';

export type FileTreeCheckpointTransport = {
  revision: number;
  strategyId: FileTreeSnapshotStrategyId;
  snapshotId: string;
  publishedAt: number;
};
export type LegacyFileTreeCheckpoint = {
  revision: number;
  snapshotKind: 'v2' | 'v3';
  snapshotId: string;
  publishedAt: number;
};
export function fromLegacyCheckpoint(raw: LegacyFileTreeCheckpoint): FileTreeCheckpointTransport {
  return { ...raw, strategyId: snapshotKindToStrategyId(raw.snapshotKind) };
}
export function toLegacyCheckpointPublishArgs(
  checkpoint: Pick<FileTreeCheckpointTransport, 'revision' | 'strategyId' | 'snapshotId'>
) {
  return {
    revision: checkpoint.revision,
    snapshotKind: strategyIdToSnapshotKind(checkpoint.strategyId),
    snapshotId: checkpoint.snapshotId,
  };
}
