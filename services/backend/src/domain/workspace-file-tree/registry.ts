// fallow-ignore-file unused-file unused-export unused-type

import { selectFileTreeSnapshotStrategyId } from './select-strategy';
import type { FileTreeSnapshotStrategy } from './strategy';
import type { FileTreeSnapshotStrategyId } from './types';
import type { FileTree } from '../entities/workspace-files';

export const blobSnapshotStrategy: FileTreeSnapshotStrategy = {
  id: 'blob',
  selectForUpload: (tree) => selectFileTreeSnapshotStrategyId(tree) === 'blob',
};

export const shardedSnapshotStrategy: FileTreeSnapshotStrategy = {
  id: 'sharded',
  selectForUpload: (tree) => selectFileTreeSnapshotStrategyId(tree) === 'sharded',
};

const STRATEGIES: readonly FileTreeSnapshotStrategy[] = [
  blobSnapshotStrategy,
  shardedSnapshotStrategy,
];

export function getFileTreeSnapshotStrategy(
  id: FileTreeSnapshotStrategyId
): FileTreeSnapshotStrategy | undefined {
  return STRATEGIES.find((strategy) => strategy.id === id);
}

export function selectFileTreeSnapshotStrategy(tree: FileTree): FileTreeSnapshotStrategy {
  const id = selectFileTreeSnapshotStrategyId(tree);
  const strategy = getFileTreeSnapshotStrategy(id);
  if (!strategy) throw new Error(`No file tree strategy registered for id: ${id}`);
  return strategy;
}

export function listFileTreeSnapshotStrategies(): readonly FileTreeSnapshotStrategy[] {
  return STRATEGIES;
}
