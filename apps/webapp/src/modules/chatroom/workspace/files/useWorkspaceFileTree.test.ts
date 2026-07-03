import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTree } from './useWorkspaceFileTree';

const mocks = vi.hoisted(() => ({
  requestFileSearch: Symbol('requestFileSearch'),
  requestFileSearchMutation: vi.fn(),
  useFileEntries: vi.fn(),
  useFileSearch: vi.fn(),
  useSessionMutation: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileSearch: mocks.requestFileSearch,
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: mocks.useSessionMutation,
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
  mocks.requestFileSearchMutation.mockResolvedValue(undefined);
  mocks.useSessionMutation.mockReturnValue(mocks.requestFileSearchMutation);
  mocks.useFileSearch.mockReturnValue({
    entries: [fileEntry],
    isLoading: false,
    refresh: vi.fn(),
  });
  mocks.useFileEntries.mockReturnValue([fileEntry]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useWorkspaceFileTree', () => {
  it('returns empty state and a no-op refresh when disabled', () => {
    const { result } = renderHook(() => useWorkspaceFileTree({ ...args, enabled: false }));

    expect(mocks.useFileSearch).toHaveBeenCalledWith('skip');
    expect(result.current).toMatchObject({
      entries: [],
      treeJson: null,
      scannedAt: null,
      isLoading: false,
    });

    act(() => {
      result.current.refresh();
    });

    expect(mocks.requestFileSearchMutation).not.toHaveBeenCalled();
  });

  it('requests empty-query file search on mount', () => {
    renderHook(() => useWorkspaceFileTree(args));
    expect(mocks.requestFileSearchMutation).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      query: '',
    });
  });

  it('calls refresh mutation with force after dedup window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTree(args));

    act(() => {
      result.current.refresh();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      result.current.refresh();
    });

    expect(mocks.requestFileSearchMutation).toHaveBeenCalledWith({
      machineId: args.machineId,
      workingDir: args.workingDir,
      query: '',
      force: true,
    });
  });
});
