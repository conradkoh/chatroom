import { createHash } from 'node:crypto';

import type { FileTree } from '@workspace/backend/src/domain/entities/workspace-files.js';
import { describe, expect, it } from 'vitest';

import { computeFileTreeDataHash } from './file-tree-data-hash.js';

const sampleTree: FileTree = {
  entries: [
    { path: 'src', type: 'directory' },
    { path: 'src/index.ts', type: 'file' },
  ],
  scannedAt: 1_700_000_000_000,
  rootDir: '/workspace',
};

describe('computeFileTreeDataHash', () => {
  it('returns stable hash for the same tree', () => {
    const first = computeFileTreeDataHash(sampleTree);
    const second = computeFileTreeDataHash(sampleTree);
    expect(first).toBe(second);
  });

  it('changes when entries change', () => {
    const original = computeFileTreeDataHash(sampleTree);
    const changed = computeFileTreeDataHash({
      ...sampleTree,
      entries: [...sampleTree.entries, { path: 'README.md', type: 'file' }],
    });
    expect(changed).not.toBe(original);
  });

  it('matches md5 of JSON.stringify(tree)', () => {
    const expected = createHash('md5').update(JSON.stringify(sampleTree)).digest('hex');
    expect(computeFileTreeDataHash(sampleTree)).toBe(expected);
  });
});
