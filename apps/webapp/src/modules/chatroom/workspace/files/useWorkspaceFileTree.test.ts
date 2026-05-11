import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestFileTree: Symbol('requestFileTree'),
  requestFileTreeMutation: vi.fn(),
  useFileEntries: vi.fn(),
  useFileTree: vi.fn(),
  useSessionMutation: vi.fn(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileTree: mocks.requestFileTree,
    },
  },
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: mocks.useSessionMutation,
}));

vi.mock('@/modules/chatroom/workspace/hooks/useFileTree', () => ({
  useFileTree: mocks.useFileTree,
}));

vi.mock('@/modules/chatroom/hooks/useFileEntries', () => ({
  useFileEntries: mocks.useFileEntries,
}));

import { useWorkspaceFileTree } from './useWorkspaceFileTree';

const args = { machineId: 'machine-1', workingDir: '/repo' };
const fileEntry = { path: 'src/index.ts', type: 'file' as const };

beforeEach(() => {
  mocks.requestFileTreeMutation.mockResolvedValue(undefined);
  mocks.useSessionMutation.mockReturnValue(mocks.requestFileTreeMutation);
  mocks.useFileTree.mockReturnValue({
    treeJson: JSON.stringify({ entries: [fileEntry] }),
    scannedAt: 123,
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

    expect(mocks.useFileTree).toHaveBeenCalledWith('skip');
    expect(result.current).toMatchObject({
      entries: [],
      treeJson: null,
      scannedAt: null,
      isLoading: false,
    });

    act(() => {
      result.current.refresh();
    });

    expect(mocks.requestFileTreeMutation).not.toHaveBeenCalled();
  });

  it('calls the refresh mutation once with machineId and workingDir', () => {
    const { result } = renderHook(() => useWorkspaceFileTree(args));

    act(() => {
      result.current.refresh();
    });

    expect(mocks.requestFileTreeMutation).toHaveBeenCalledTimes(1);
    expect(mocks.requestFileTreeMutation).toHaveBeenCalledWith(args);
  });

  it('deduplicates refresh calls within 1500ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTree(args));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    expect(mocks.requestFileTreeMutation).toHaveBeenCalledTimes(1);
  });

  it('allows refresh calls after the dedup window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTree(args));

    act(() => {
      result.current.refresh();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
      result.current.refresh();
    });

    expect(mocks.requestFileTreeMutation).toHaveBeenCalledTimes(2);
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(1, args);
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(2, args);
  });
});
