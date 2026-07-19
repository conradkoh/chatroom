import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetWorkspaceFileTreeStoreForTests,
  applyWorkspaceFileTreeDeltas,
  clearWorkspaceFileTree,
  getWorkspaceFileTreeEntries,
  getWorkspaceFileTreeRevision,
  getWorkspaceFileTreeScannedAt,
  subscribeWorkspaceFileTree,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from './workspaceFileTreeStore';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

beforeEach(() => {
  __resetWorkspaceFileTreeStoreForTests();
});

describe('workspaceFileTreeStore', () => {
  it('upserts and reads flat entries with scannedAt', () => {
    upsertWorkspaceFileTree(
      KEY,
      [
        { path: 'src', type: 'directory' },
        { path: 'src/index.ts', type: 'file' },
      ],
      1_700_000_000_000
    );

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([
      { path: 'src', type: 'directory' },
      { path: 'src/index.ts', type: 'file' },
    ]);
    expect(getWorkspaceFileTreeScannedAt(KEY)).toBe(1_700_000_000_000);
  });

  it('skips emit when entries and scannedAt are unchanged', () => {
    const listener = vi.fn();
    subscribeWorkspaceFileTree(KEY, listener);

    const entries = [{ path: 'README.md', type: 'file' as const }];
    upsertWorkspaceFileTree(KEY, entries, 100);
    upsertWorkspaceFileTree(KEY, [...entries], 100);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not replace a delta-advanced tree with an older checkpoint', () => {
    upsertWorkspaceFileTree(KEY, [{ path: 'new.ts', type: 'file' }], 200, 5);
    upsertWorkspaceFileTree(KEY, [{ path: 'old.ts', type: 'file' }], 100, 3);

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'new.ts', type: 'file' }]);
    expect(getWorkspaceFileTreeRevision(KEY)).toBe(5);
  });

  it('clears workspace tree bucket', () => {
    upsertWorkspaceFileTree(KEY, [{ path: 'README.md', type: 'file' }], 100);
    clearWorkspaceFileTree(KEY);
    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([]);
    expect(getWorkspaceFileTreeScannedAt(KEY)).toBeNull();
  });

  it('notifies subscribers on upsert', () => {
    const listener = vi.fn();
    subscribeWorkspaceFileTree(KEY, listener);

    upsertWorkspaceFileTree(KEY, [{ path: 'README.md', type: 'file' }], 100);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('applies ordered add, remove, and type-change batches', () => {
    upsertWorkspaceFileTree(
      KEY,
      [
        { path: 'README.md', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
      100,
      4
    );

    expect(
      applyWorkspaceFileTreeDeltas(KEY, [
        {
          baseRevision: 4,
          revision: 5,
          scannedAt: 110,
          operations: [
            { operation: 'remove', path: 'README.md' },
            {
              operation: 'add',
              path: 'src/index.ts',
              entryType: 'file',
              size: 12,
            },
          ],
        },
        {
          baseRevision: 5,
          revision: 6,
          operations: [{ operation: 'type-change', path: 'src', entryType: 'file' }],
        },
      ])
    ).toEqual({ status: 'applied', revision: 6 });
    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([
      { path: 'src', type: 'file' },
      { path: 'src/index.ts', type: 'file', size: 12 },
    ]);
    expect(getWorkspaceFileTreeRevision(KEY)).toBe(6);
    expect(getWorkspaceFileTreeScannedAt(KEY)).toBe(110);
  });

  it('is idempotent for already-applied batches', () => {
    upsertWorkspaceFileTree(KEY, [{ path: 'a.ts', type: 'file' }], 100, 2);
    const listener = vi.fn();
    subscribeWorkspaceFileTree(KEY, listener);

    const result = applyWorkspaceFileTreeDeltas(KEY, [
      {
        baseRevision: 1,
        revision: 2,
        operations: [{ operation: 'add', path: 'a.ts', entryType: 'file' }],
      },
    ]);

    expect(result).toEqual({ status: 'already-applied', revision: 2 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects revision gaps without partially applying a batch', () => {
    upsertWorkspaceFileTree(KEY, [{ path: 'a.ts', type: 'file' }], 100, 2);

    expect(
      applyWorkspaceFileTreeDeltas(KEY, [
        {
          baseRevision: 3,
          revision: 4,
          operations: [{ operation: 'add', path: 'b.ts', entryType: 'file' }],
        },
      ])
    ).toEqual({ status: 'requires-refresh', revision: 2 });
    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'a.ts', type: 'file' }]);
    expect(getWorkspaceFileTreeRevision(KEY)).toBe(2);
  });
});
