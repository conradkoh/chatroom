// fallow-ignore-file unused-file unused-export unused-type

import type {
  FileTree,
  FileTreeEntry,
  FileTreeSnapshotRef,
  FileTreeSnapshotStrategyId,
} from './types';

export interface FileTreeSnapshotStrategy {
  readonly id: FileTreeSnapshotStrategyId;
  selectForUpload(tree: FileTree): boolean;
}

export interface FileTreeSnapshotReader {
  readonly id: FileTreeSnapshotStrategyId;
  hydrateSnapshot(
    machineId: string,
    workingDir: string,
    ref: FileTreeSnapshotRef
  ): Promise<FileTreeEntry[]>;
}

export interface FileTreeSnapshotPublisher {
  readonly id: FileTreeSnapshotStrategyId;
  publishSnapshot(
    machineId: string,
    workingDir: string,
    tree: FileTree
  ): Promise<FileTreeSnapshotRef>;
}
