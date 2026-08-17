import { describe, expect, it } from 'vitest';

import {
  selectFileTreeSnapshotStrategyId,
  shouldUseShardedStrategy,
  treeJsonByteLength,
} from './select-strategy';
import { MAX_TREE_JSON_BYTES } from './types';
import type { FileTree } from '../entities/workspace-files';

const baseTree = (entries: FileTree['entries']): FileTree => ({
  entries,
  scannedAt: Date.now(),
  rootDir: '/workspace',
});

describe('selectFileTreeSnapshotStrategyId', () => {
  it('selects blob for small trees', () => {
    const tree = baseTree([{ path: 'a.ts', type: 'file' }]);
    expect(selectFileTreeSnapshotStrategyId(tree)).toBe('blob');
    expect(shouldUseShardedStrategy(tree)).toBe(false);
  });

  it('selects sharded when JSON exceeds MAX_TREE_JSON_BYTES', () => {
    const tree = baseTree([{ path: 'x'.repeat(MAX_TREE_JSON_BYTES), type: 'file' }]);
    expect(treeJsonByteLength(tree)).toBeGreaterThan(MAX_TREE_JSON_BYTES);
    expect(selectFileTreeSnapshotStrategyId(tree)).toBe('sharded');
  });
});
