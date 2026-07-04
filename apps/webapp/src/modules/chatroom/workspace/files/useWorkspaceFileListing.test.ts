import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileListing } from './useWorkspaceFileListing';

const mocks = vi.hoisted(() => ({
  searchRefresh: vi.fn(),
  useFileEntries: vi.fn(),
  useFileSearch: vi.fn(),
}));

vi.mock('@/modules/chatroom/workspace/files/useFileSearch', () => ({
  useFileSearch: mocks.useFileSearch,
}));

vi.mock('@/modules/chatroom/workspace/files/useFileEntries', () => ({
  useFileEntries: mocks.useFileEntries,
}));

const args = { machineId: 'machine-1', workingDir: '/repo' };
const fileEntry = { path: 'src/index.ts', type: 'file' as const };

beforeEach(() => {
  mocks.searchRefresh.mockReset();
  mocks.useFileSearch.mockReturnValue({
    entries: [fileEntry],
    isLoading: false,
    refresh: mocks.searchRefresh,
  });
  mocks.useFileEntries.mockReturnValue([fileEntry]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useWorkspaceFileListing', () => {
  it('returns empty state and a no-op refresh when disabled', () => {
    const { result } = renderHook(() => useWorkspaceFileListing({ ...args, enabled: false }));

    expect(mocks.useFileSearch).toHaveBeenCalledWith('skip');
    expect(result.current).toMatchObject({
      entries: [],
      isLoading: false,
    });

    act(() => {
      result.current.refresh();
    });

    expect(mocks.searchRefresh).not.toHaveBeenCalled();
  });

  it('delegates to useFileSearch with empty query when enabled', () => {
    renderHook(() => useWorkspaceFileListing(args));
    expect(mocks.useFileSearch).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      query: '',
      enabled: true,
    });
  });

  it('calls searchResult.refresh after dedup window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileListing(args));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });
    expect(mocks.searchRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      result.current.refresh();
    });

    expect(mocks.searchRefresh).toHaveBeenCalledTimes(2);
  });
});
