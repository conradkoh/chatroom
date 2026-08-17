// fallow-ignore-file unused-file unused-export unused-type

import { MAX_TREE_JSON_BYTES, type FileTreeSnapshotStrategyId } from './types';
import type { FileTree } from '../entities/workspace-files';

export function treeJsonByteLength(tree: FileTree): number {
  return Buffer.byteLength(JSON.stringify(tree), 'utf8');
}

export function selectFileTreeSnapshotStrategyId(tree: FileTree): FileTreeSnapshotStrategyId {
  return treeJsonByteLength(tree) > MAX_TREE_JSON_BYTES ? 'sharded' : 'blob';
}

export function shouldUseShardedStrategy(tree: FileTree): boolean {
  return selectFileTreeSnapshotStrategyId(tree) === 'sharded';
}
