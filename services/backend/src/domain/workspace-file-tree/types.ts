// fallow-ignore-file unused-file unused-export unused-type

import type { FileTree, FileTreeEntry } from '../entities/workspace-files';

export const MAX_TREE_JSON_BYTES = 900 * 1024;
export type FileTreeSnapshotStrategyId = 'blob' | 'sharded';
export type FileTreeSyncStatus = 'idle' | 'requested' | 'syncing' | 'ready' | 'failed';

export interface FileTreeSnapshotRef {
  strategyId: FileTreeSnapshotStrategyId;
  snapshotId: string;
  scannedAt: number;
  entryCount: number;
}

export interface WorkspaceFileTreeSyncState {
  machineId: string;
  workingDir: string;
  revision: number;
  activeStrategy: FileTreeSnapshotStrategyId | null;
  snapshot: FileTreeSnapshotRef | null;
  syncStatus: FileTreeSyncStatus;
  requestedAt?: number | undefined;
  force?: boolean | undefined;
}

export function snapshotKindToStrategyId(kind: 'v2' | 'v3'): FileTreeSnapshotStrategyId {
  return kind === 'v2' ? 'blob' : 'sharded';
}

export function strategyIdToSnapshotKind(id: FileTreeSnapshotStrategyId): 'v2' | 'v3' {
  return id === 'blob' ? 'v2' : 'v3';
}

export type { FileTree, FileTreeEntry };
