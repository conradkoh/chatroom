import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFileTrees } from './useMultiWorkspaceFileTrees';

import type { Workspace } from '@/modules/chatroom/types/workspace';

const mocks = vi.hoisted(() => ({
  refreshFns: [] as ReturnType<typeof vi.fn>[],
  useWorkspaceFileTree: vi.fn(),
}));

vi.mock('./useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: mocks.useWorkspaceFileTree,
}));

function makeWorkspace(machineId: string | null, workingDir: string): Workspace {
  return {
    id: `${machineId ?? 'unassigned'}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: [],
  };
}

beforeEach(() => {
  mocks.refreshFns = [];
  mocks.useWorkspaceFileTree.mockImplementation(({ enabled }: { enabled?: boolean }) => {
    const refresh = vi.fn();
    if (enabled) mocks.refreshFns.push(refresh);
    return {
      entries: [],
      rootNodes: [],
      scannedAt: null,
      isLoading: false,
      hasTree: false,
      refresh,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFileTrees', () => {
  it('allocates up to 10 workspace slots and refreshAll calls enabled slots', async () => {
    vi.useFakeTimers();
    const workspaces = [
      makeWorkspace('machine-1', '/repo-a/'),
      makeWorkspace('machine-2', '/repo-b'),
    ];
    const { result } = renderHook(() => useMultiWorkspaceFileTrees(workspaces));

    expect(mocks.useWorkspaceFileTree).toHaveBeenCalledTimes(10);
    expect(mocks.refreshFns).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    mocks.refreshFns.forEach((fn) => fn.mockClear());

    act(() => {
      result.current.refreshAll({ force: true });
    });

    expect(mocks.refreshFns[0]).toHaveBeenCalledWith({ force: true });
    expect(mocks.refreshFns[1]).toHaveBeenCalledWith({ force: true });
  });
});
