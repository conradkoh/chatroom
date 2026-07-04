import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceDirExplorer } from './useWorkspaceDirExplorer';

const EMPTY_ENTRIES: never[] = [];
const refreshRootListing = vi.fn();
const refreshFileSearch = vi.fn();

vi.mock('./useDirListing', () => ({
  useDirListing: () => ({
    entries: EMPTY_ENTRIES,
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
});
