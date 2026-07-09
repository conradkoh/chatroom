import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileListing } from './useWorkspaceFileListing';

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  useWorkspaceFileTreeEntries: vi.fn(),
}));

vi.mock('./useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: mocks.useWorkspaceFileTreeEntries,
}));

const args = { machineId: 'machine-1', workingDir: '/repo' };
const fileEntry = { path: 'src/index.ts', type: 'file' as const };
const directoryEntry = { path: 'src', type: 'directory' as const };

beforeEach(() => {
  mocks.refresh.mockReset();
  mocks.useWorkspaceFileTreeEntries.mockReturnValue({
    entries: [fileEntry],
    isLoading: false,
    hasTree: true,
    refresh: mocks.refresh,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWorkspaceFileListing', () => {
  it('delegates to useWorkspaceFileTreeEntries with the same args', () => {
    renderHook(() => useWorkspaceFileListing({ ...args, includeDirectories: true }));

    expect(mocks.useWorkspaceFileTreeEntries).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      includeDirectories: true,
    });
  });

  it('returns entries, refresh, and isLoading from the tree entries hook', () => {
    mocks.useWorkspaceFileTreeEntries.mockReturnValue({
      entries: [fileEntry, directoryEntry],
      isLoading: true,
      hasTree: true,
      refresh: mocks.refresh,
    });

    const { result } = renderHook(() =>
      useWorkspaceFileListing({ ...args, includeDirectories: true })
    );

    expect(result.current).toEqual({
      entries: [fileEntry, directoryEntry],
      isLoading: true,
      refresh: mocks.refresh,
    });
  });

  it('forwards refresh options to the tree entries hook', () => {
    const { result } = renderHook(() => useWorkspaceFileListing(args));

    act(() => {
      result.current.refresh({ force: true });
    });

    expect(mocks.refresh).toHaveBeenCalledWith({ force: true });
  });
});
