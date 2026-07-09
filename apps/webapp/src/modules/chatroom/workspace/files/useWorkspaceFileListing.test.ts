import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileListing } from './useWorkspaceFileListing';

const mocks = vi.hoisted(() => ({
  searchRefresh: vi.fn(),
  dirRefresh: vi.fn(),
  useFileEntries: vi.fn(),
  useFileSearch: vi.fn(),
  useDirListing: vi.fn(),
  useTrackedWorkspaceFiles: vi.fn(),
}));

vi.mock('@/modules/chatroom/workspace/files/useFileSearch', () => ({
  useFileSearch: mocks.useFileSearch,
}));

vi.mock('@/modules/chatroom/workspace/files/useDirListing', () => ({
  useDirListing: mocks.useDirListing,
}));

vi.mock('@/modules/chatroom/workspace/files/useFileEntries', () => ({
  useFileEntries: mocks.useFileEntries,
}));

vi.mock('./useTrackedWorkspaceFiles', () => ({
  useTrackedWorkspaceFiles: mocks.useTrackedWorkspaceFiles,
}));

const args = { machineId: 'machine-1', workingDir: '/repo' };
const fileEntry = { path: 'src/index.ts', type: 'file' as const };
const directoryEntry = { path: 'src/auth', type: 'directory' as const };
const trackedNestedFile = { path: 'src/auth/login.ts', type: 'file' as const };
const trackedNestedDirectory = { path: 'src/auth/hooks', type: 'directory' as const };

beforeEach(() => {
  mocks.searchRefresh.mockReset();
  mocks.dirRefresh.mockReset();
  mocks.useFileSearch.mockReturnValue({
    entries: [fileEntry],
    isLoading: false,
    refresh: mocks.searchRefresh,
  });
  mocks.useDirListing.mockReturnValue({
    entries: [directoryEntry],
    isLoading: false,
    refresh: mocks.dirRefresh,
  });
  mocks.useTrackedWorkspaceFiles.mockReturnValue([]);
  mocks.useFileEntries.mockImplementation(
    (
      result: { entries?: { path: string; type: 'file' | 'directory' }[] } | null,
      options?: { includeDirectories?: boolean }
    ) => {
      if (!result?.entries?.length) return [];
      if (options?.includeDirectories) {
        return result.entries.filter(
          (entry) => entry.type === 'file' || entry.type === 'directory'
        );
      }
      return result.entries.filter((entry) => entry.type === 'file');
    }
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useWorkspaceFileListing', () => {
  it('returns empty state and a no-op refresh when disabled', () => {
    const { result } = renderHook(() => useWorkspaceFileListing({ ...args, enabled: false }));

    expect(mocks.useFileSearch).toHaveBeenCalledWith('skip');
    expect(mocks.useDirListing).toHaveBeenCalledWith('skip');
    expect(result.current).toMatchObject({
      entries: [],
      isLoading: false,
    });

    act(() => {
      result.current.refresh();
    });

    expect(mocks.searchRefresh).not.toHaveBeenCalled();
    expect(mocks.dirRefresh).not.toHaveBeenCalled();
  });

  it('delegates to useFileSearch with empty query when enabled', () => {
    renderHook(() => useWorkspaceFileListing(args));
    expect(mocks.useFileSearch).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      query: '',
      enabled: true,
    });
    expect(mocks.useDirListing).toHaveBeenCalledWith('skip');
  });

  it('merges root directory listings when includeDirectories is true', () => {
    const { result } = renderHook(() =>
      useWorkspaceFileListing({ ...args, includeDirectories: true })
    );

    expect(mocks.useDirListing).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      dirPath: '',
    });
    expect(result.current.entries).toEqual([fileEntry, directoryEntry]);
  });

  it('includes tracked nested files and directories when includeDirectories is true', () => {
    mocks.useTrackedWorkspaceFiles.mockReturnValue([trackedNestedFile, trackedNestedDirectory]);

    const { result } = renderHook(() =>
      useWorkspaceFileListing({ ...args, includeDirectories: true })
    );

    expect(result.current.entries).toEqual(
      expect.arrayContaining([fileEntry, directoryEntry, trackedNestedFile, trackedNestedDirectory])
    );
  });

  it('includes only tracked files when includeDirectories is false', () => {
    mocks.useTrackedWorkspaceFiles.mockReturnValue([trackedNestedFile, trackedNestedDirectory]);

    const { result } = renderHook(() => useWorkspaceFileListing(args));

    expect(result.current.entries).toEqual([fileEntry, trackedNestedFile]);
    expect(result.current.entries).not.toContainEqual(trackedNestedDirectory);
  });

  it('calls search and dir refresh after dedup window when includeDirectories is true', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useWorkspaceFileListing({ ...args, includeDirectories: true })
    );

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(mocks.searchRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.dirRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      result.current.refresh();
    });

    expect(mocks.searchRefresh).toHaveBeenCalledTimes(2);
    expect(mocks.dirRefresh).toHaveBeenCalledTimes(2);
  });
});
