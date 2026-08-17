import { describe, expect, it } from 'vitest';

import {
  blobSnapshotStrategy,
  getFileTreeSnapshotStrategy,
  listFileTreeSnapshotStrategies,
  selectFileTreeSnapshotStrategy,
  shardedSnapshotStrategy,
} from './registry';
import type { FileTree } from '../entities/workspace-files';

const tree = (path: string): FileTree => ({
  entries: [{ path, type: 'file' }],
  scannedAt: 1,
  rootDir: '/',
});

describe('file tree strategy registry', () => {
  it('contains blob and sharded strategies', () => {
    expect(listFileTreeSnapshotStrategies()).toEqual([
      blobSnapshotStrategy,
      shardedSnapshotStrategy,
    ]);
  });
  it('resolves and selects registered strategies', () => {
    expect(getFileTreeSnapshotStrategy('blob')).toBe(blobSnapshotStrategy);
    expect(selectFileTreeSnapshotStrategy(tree('small')).id).toBe('blob');
  });
});
