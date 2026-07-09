import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetTrackedWorkspaceFilesStoreForTests,
  getTrackedFileEntries,
  toTrackedWorkspaceKey,
} from './trackedWorkspaceFilesStore';
import { useWorkspaceDirExplorer } from './useWorkspaceDirExplorer';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/workspace';
const WORKSPACE_KEY = toTrackedWorkspaceKey(MACHINE_ID, WORKING_DIR);

const mocks = vi.hoisted(() => ({
  rootEntries: [] as { name: string; path: string; type: 'file' | 'directory' }[],
}));

const EMPTY_ENTRIES: never[] = [];
const refreshRootListing = vi.fn();
const refreshFileSearch = vi.fn();

vi.mock('./useDirListing', () => ({
  useDirListing: () => ({
    entries: mocks.rootEntries,
    isLoading: true,
    refresh: refreshRootListing,
    scannedAt: null,
    truncated: false,
  }),
}));

vi.mock('./useFileSearch', () => ({
  useFileSearch: () => ({
    entries: EMPTY_ENTRIES,
    isLoading: false,
    refresh: refreshFileSearch,
  }),
}));

beforeEach(() => {
  refreshRootListing.mockClear();
  refreshFileSearch.mockClear();
  mocks.rootEntries = [];
  __resetTrackedWorkspaceFilesStoreForTests();
});

describe('useWorkspaceDirExplorer', () => {
  it('does not churn childMap when watcher reports the same stable empty entries while loading', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: 'machine-1',
        workingDir: '/workspace',
      })
    );

    act(() => {
      result.current.handleDirUpdate('src', EMPTY_ENTRIES, true);
    });

    const childMapAfterFirstUpdate = result.current.childMap;

    act(() => {
      result.current.handleDirUpdate('src', EMPTY_ENTRIES, true);
      result.current.handleDirUpdate('src', EMPTY_ENTRIES, true);
    });

    expect(result.current.childMap).toBe(childMapAfterFirstUpdate);
    expect(result.current.loadingDirs.has('src')).toBe(true);
  });

  it('does not churn childMap when watcher reports new empty arrays with identical contents while loading', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: 'machine-1',
        workingDir: '/workspace',
      })
    );

    act(() => {
      result.current.handleDirUpdate('src', [], true);
    });

    const childMapAfterFirstUpdate = result.current.childMap;

    act(() => {
      result.current.handleDirUpdate('src', [], true);
      result.current.handleDirUpdate('src', [], true);
    });

    expect(result.current.childMap).toBe(childMapAfterFirstUpdate);
  });

  it('does not re-add loadingDirs when loadChildren is called for an already-requested directory', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: 'machine-1',
        workingDir: '/workspace',
      })
    );

    act(() => {
      result.current.loadChildren('src');
    });
    act(() => {
      result.current.handleDirUpdate('src', [], false);
    });
    expect(result.current.loadingDirs.has('src')).toBe(false);

    const loadingDirsBefore = result.current.loadingDirs;
    act(() => {
      result.current.loadChildren('src');
    });
    expect(result.current.loadingDirs).toBe(loadingDirsBefore);
    expect(result.current.loadingDirs.has('src')).toBe(false);
  });

  it('skips loadChildren loadingDirs update when directory is already loading', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: 'machine-1',
        workingDir: '/workspace',
      })
    );

    act(() => {
      result.current.loadChildren('src');
    });

    const loadingDirsAfterFirst = result.current.loadingDirs;

    act(() => {
      result.current.loadChildren('src');
    });

    expect(result.current.loadingDirs).toBe(loadingDirsAfterFirst);
  });

  it('calls refresh only once when refreshSignal stays positive across rerenders', () => {
    const { rerender } = renderHook(
      ({ refreshSignal }) =>
        useWorkspaceDirExplorer({
          machineId: 'machine-1',
          workingDir: '/workspace',
          refreshSignal,
        }),
      { initialProps: { refreshSignal: 1 } }
    );

    rerender({ refreshSignal: 1 });
    rerender({ refreshSignal: 1 });
    rerender({ refreshSignal: 1 });

    expect(refreshRootListing).toHaveBeenCalledTimes(1);
    expect(refreshFileSearch).toHaveBeenCalledTimes(1);
  });

  it('calls refresh again only when refreshSignal increments', () => {
    const { rerender } = renderHook(
      ({ refreshSignal }) =>
        useWorkspaceDirExplorer({
          machineId: 'machine-1',
          workingDir: '/workspace',
          refreshSignal,
        }),
      { initialProps: { refreshSignal: 1 } }
    );

    rerender({ refreshSignal: 2 });

    expect(refreshRootListing).toHaveBeenCalledTimes(2);
    expect(refreshFileSearch).toHaveBeenCalledTimes(2);
  });

  it('publishes nested explorer listings to the tracked store', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
      })
    );

    act(() => {
      result.current.handleDirUpdate(
        'src/auth',
        [
          { name: 'login.ts', path: 'src/auth/login.ts', type: 'file' },
          { name: 'hooks', path: 'src/auth/hooks', type: 'directory' },
        ],
        false
      );
    });

    const tracked = getTrackedFileEntries(WORKSPACE_KEY);
    expect(tracked).toEqual(
      expect.arrayContaining([
        { path: 'src/auth/login.ts', type: 'file' },
        { path: 'src/auth/hooks', type: 'directory' },
      ])
    );
  });

  it('publishes root listings to the tracked store', () => {
    mocks.rootEntries = [{ name: 'README.md', path: 'README.md', type: 'file' }];

    renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
      })
    );

    expect(getTrackedFileEntries(WORKSPACE_KEY)).toEqual(
      expect.arrayContaining([{ path: 'README.md', type: 'file' }])
    );
  });
});
