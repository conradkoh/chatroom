import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetWorkspaceFileTreeStoreForTests,
  clearWorkspaceFileTree,
  getWorkspaceFileTreeEntries,
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
});
