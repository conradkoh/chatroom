import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFileSync } from './useMultiWorkspaceFileSync';
import { __resetWorkspaceFileTreeRefreshCoordinatorForTests } from './workspaceFileTreeRefreshCoordinator';

import type { Workspace } from '@/modules/chatroom/types/workspace';

const mocks = vi.hoisted(() => ({
  refreshFns: [] as ReturnType<typeof vi.fn>[],
  treeEntries: [] as { path: string; type: 'file' | 'directory' }[],
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
  useWorkspaceFileTree: vi.fn(),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
}));

vi.mock('./useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: mocks.useWorkspaceFileTree,
}));

function makeWorkspace(machineId: string, workingDir: string): Workspace {
  return {
    id: `${machineId}::${workingDir}`,
    machineId,
    hostname: 'host',
    workingDir,
    agentRoles: [],
  };
}

beforeEach(() => {
  __resetWorkspaceFileTreeRefreshCoordinatorForTests();
  mocks.refreshFns = [];
  mocks.treeEntries = [];
  mocks.requestMutation.mockClear();
  mocks.useWorkspaceFileTree.mockImplementation(({ enabled }: { enabled?: boolean }) => {
    const refresh = vi.fn();
    if (enabled) mocks.refreshFns.push(refresh);
    return {
      entries: enabled ? mocks.treeEntries : [],
      rootNodes: [],
      scannedAt: null,
      isLoading: false,
      hasTree: enabled && mocks.treeEntries.length > 0,
      refresh,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFileSync', () => {
  it('merges producer entries with workspaceId tags', () => {
    mocks.treeEntries = [
      { path: 'src/a.ts', type: 'file' },
      { path: 'src', type: 'directory' },
    ];
    const workspaces = [makeWorkspace('machine-1', '/repo-a/')];
    const { result } = renderHook(() => useMultiWorkspaceFileSync(workspaces));

    expect(result.current.files).toEqual([
      expect.objectContaining({ path: 'src/a.ts', workspaceId: expect.any(String) }),
      expect.objectContaining({ path: 'src', workspaceId: expect.any(String) }),
    ]);
    expect(mocks.useWorkspaceFileTree).toHaveBeenCalledTimes(10);
  });

  it('refreshAll uses shared coordinator and consumer-style mutation', async () => {
    vi.useFakeTimers();
    const workspaces = [
      makeWorkspace('machine-1', '/repo-a/'),
      makeWorkspace('machine-2', '/repo-b'),
    ];
    const { result } = renderHook(() => useMultiWorkspaceFileSync(workspaces));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    mocks.requestMutation.mockClear();

    act(() => {
      result.current.refreshAll({ force: true });
    });

    expect(mocks.requestMutation).toHaveBeenCalledTimes(2);
    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/repo-a',
      force: true,
    });
    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: 'machine-2',
      workingDir: '/repo-b',
      force: true,
    });
    expect(mocks.refreshFns[0]).not.toHaveBeenCalled();
  });

  it('refreshAll dedupes repeated calls within coordinator window', () => {
    vi.useFakeTimers();
    const workspaces = [makeWorkspace('machine-1', '/repo-a/')];
    const { result } = renderHook(() => useMultiWorkspaceFileSync(workspaces));

    act(() => {
      result.current.refreshAll();
      result.current.refreshAll();
    });

    expect(mocks.requestMutation).toHaveBeenCalledTimes(1);
    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/repo-a',
    });
  });
});
