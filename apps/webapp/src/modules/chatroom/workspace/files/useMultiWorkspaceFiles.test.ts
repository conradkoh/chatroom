import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFiles } from './useMultiWorkspaceFiles';

import type { Workspace } from '@/modules/chatroom/types/workspace';

const mocks = vi.hoisted(() => ({
  refreshFns: [] as ReturnType<typeof vi.fn>[],
  useWorkspaceFileListing: vi.fn(),
}));

vi.mock('./useWorkspaceFileListing', () => ({
  useWorkspaceFileListing: mocks.useWorkspaceFileListing,
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
  mocks.useWorkspaceFileListing.mockImplementation(({ enabled }: { enabled?: boolean }) => {
    const refresh = vi.fn();
    if (enabled) mocks.refreshFns.push(refresh);
    return {
      entries: [],
      isLoading: false,
      refresh,
    };
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFiles', () => {
  it('refreshAll calls each enabled slot refresh exactly once', async () => {
    vi.useFakeTimers();
    const workspaces = [
      makeWorkspace('machine-1', '/repo-a/'),
      makeWorkspace('machine-2', '/repo-b'),
    ];
    const { result } = renderHook(() => useMultiWorkspaceFiles(workspaces));

    expect(mocks.refreshFns).toHaveLength(2);
    expect(mocks.useWorkspaceFileListing).toHaveBeenNthCalledWith(1, {
      machineId: 'machine-1',
      workingDir: '/repo-a',
      enabled: true,
      includeDirectories: true,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    mocks.refreshFns.forEach((fn) => fn.mockClear());

    act(() => {
      result.current.refreshAll();
    });

    expect(mocks.refreshFns[0]).toHaveBeenCalledTimes(1);
    expect(mocks.refreshFns[1]).toHaveBeenCalledTimes(1);
  });
});
