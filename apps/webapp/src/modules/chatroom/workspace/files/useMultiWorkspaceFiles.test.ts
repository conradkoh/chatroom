import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFiles } from './useMultiWorkspaceFiles';

import type { Workspace } from '@/modules/chatroom/types/workspace';

const mocks = vi.hoisted(() => ({
  refreshFns: [] as ReturnType<typeof vi.fn>[],
  useWorkspaceFileTreeEntries: vi.fn(),
}));

vi.mock('./useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: mocks.useWorkspaceFileTreeEntries,
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
  mocks.useWorkspaceFileTreeEntries.mockImplementation(({ enabled }: { enabled?: boolean }) => {
    const refresh = vi.fn();
    if (enabled) mocks.refreshFns.push(refresh);
    return {
      entries: [],
      isLoading: false,
      hasTree: false,
      refresh,
    };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFiles', () => {
  it('refreshAll calls each enabled slot refresh with options', () => {
    const workspaces = [
      makeWorkspace('machine-1', '/repo-a/'),
      makeWorkspace('machine-2', '/repo-b'),
    ];
    const { result } = renderHook(() => useMultiWorkspaceFiles(workspaces));

    expect(mocks.refreshFns).toHaveLength(2);
    expect(mocks.useWorkspaceFileTreeEntries).toHaveBeenNthCalledWith(1, {
      machineId: 'machine-1',
      workingDir: '/repo-a',
      enabled: true,
      includeDirectories: true,
    });

    act(() => {
      result.current.refreshAll({ force: true });
    });

    expect(mocks.refreshFns[0]).toHaveBeenCalledWith({ force: true });
    expect(mocks.refreshFns[1]).toHaveBeenCalledWith({ force: true });
  });
});
