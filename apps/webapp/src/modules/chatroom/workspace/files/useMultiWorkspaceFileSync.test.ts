import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFileSync } from './useMultiWorkspaceFileSync';
import { __resetWorkspaceFileTreeRefreshCoordinatorForTests } from './workspaceFileTreeRefreshCoordinator';

import type { Workspace } from '@/modules/chatroom/types/workspace';
import {
  __resetWorkspaceFileTreeStoreForTests,
  upsertWorkspaceFileTree,
  toWorkspaceFileTreeKey,
} from '@/modules/chatroom/workspace/stores/workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
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
  __resetWorkspaceFileTreeStoreForTests();
  mocks.requestMutation.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFileSync', () => {
  it('merges cached store entries with workspaceId tags', () => {
    const workspaces = [makeWorkspace('machine-1', '/repo-a/')];
    const key = toWorkspaceFileTreeKey('machine-1', '/repo-a');
    upsertWorkspaceFileTree(
      key,
      [
        { path: 'src/a.ts', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
      100,
      1
    );

    const { result } = renderHook(() => useMultiWorkspaceFileSync(workspaces));

    expect(result.current.files).toEqual([
      expect.objectContaining({ path: 'src/a.ts', workspaceId: expect.any(String) }),
      expect.objectContaining({ path: 'src', workspaceId: expect.any(String) }),
    ]);
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
