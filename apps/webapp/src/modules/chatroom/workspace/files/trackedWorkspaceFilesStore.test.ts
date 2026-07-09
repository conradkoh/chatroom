import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTrackedWorkspaceFilesStoreForTests,
  clearTrackedWorkspace,
  getTrackedFileEntries,
  subscribeTrackedWorkspace,
  toTrackedWorkspaceKey,
  upsertTrackedDirListing,
} from './trackedWorkspaceFilesStore';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toTrackedWorkspaceKey(MACHINE_ID, WORKING_DIR);

beforeEach(() => {
  __resetTrackedWorkspaceFilesStoreForTests();
});

describe('mergeTrackedFileEntries', () => {
  it('dedupes by path+type and preserves first occurrence', () => {
    upsertTrackedDirListing(KEY, 'a', [{ name: 'a.ts', path: 'src/a.ts', type: 'file' }]);
    upsertTrackedDirListing(KEY, 'b', [
      { name: 'a.ts', path: 'src/a.ts', type: 'file', size: 99 },
      { name: 'b.ts', path: 'src/b.ts', type: 'file' },
    ]);

    expect(getTrackedFileEntries(KEY)).toEqual([
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
    ]);
  });
});

describe('trackedWorkspaceFilesStore', () => {
  it('includes nested explorer-loaded paths missing from file search alone', () => {
    upsertTrackedDirListing(KEY, 'src/auth', [
      { name: 'login.ts', path: 'src/auth/login.ts', type: 'file' },
      { name: 'hooks', path: 'src/auth/hooks', type: 'directory' },
    ]);

    const entries = getTrackedFileEntries(KEY);

    expect(entries).toEqual(
      expect.arrayContaining([
        { path: 'src/auth/login.ts', type: 'file' },
        { path: 'src/auth/hooks', type: 'directory' },
      ])
    );
  });

  it('replaces entries for the same dirPath only (partial invalidate)', () => {
    upsertTrackedDirListing(KEY, 'src/auth', [
      { name: 'login.ts', path: 'src/auth/login.ts', type: 'file' },
    ]);
    upsertTrackedDirListing(KEY, 'src/lib', [
      { name: 'util.ts', path: 'src/lib/util.ts', type: 'file' },
    ]);

    upsertTrackedDirListing(KEY, 'src/auth', [
      { name: 'logout.ts', path: 'src/auth/logout.ts', type: 'file' },
    ]);

    const paths = getTrackedFileEntries(KEY).map((e) => e.path);
    expect(paths).toContain('src/auth/logout.ts');
    expect(paths).not.toContain('src/auth/login.ts');
    expect(paths).toContain('src/lib/util.ts');
  });

  it('clears all tracked entries for a workspace', () => {
    upsertTrackedDirListing(KEY, '', [{ name: 'README.md', path: 'README.md', type: 'file' }]);
    clearTrackedWorkspace(KEY);
    expect(getTrackedFileEntries(KEY)).toEqual([]);
  });

  it('notifies subscribers on upsert', () => {
    const listener = vi.fn();
    subscribeTrackedWorkspace(KEY, listener);

    upsertTrackedDirListing(KEY, 'src', [{ name: 'index.ts', path: 'src/index.ts', type: 'file' }]);

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('returns the same array reference when contents are unchanged', () => {
    upsertTrackedDirListing(KEY, 'src', [{ name: 'index.ts', path: 'src/index.ts', type: 'file' }]);

    const first = getTrackedFileEntries(KEY);
    const second = getTrackedFileEntries(KEY);

    expect(first).toBe(second);
  });
});
