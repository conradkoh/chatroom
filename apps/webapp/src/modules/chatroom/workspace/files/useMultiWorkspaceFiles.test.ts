import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Workspace } from '@/modules/chatroom/types/workspace';

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

import { useMultiWorkspaceFiles } from './useMultiWorkspaceFiles';

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
  mocks.requestFileTreeMutation.mockResolvedValue(undefined);
  mocks.useSessionMutation.mockReturnValue(mocks.requestFileTreeMutation);
  mocks.useFileTree.mockReturnValue(null);
  mocks.useFileEntries.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useMultiWorkspaceFiles', () => {
  it('refreshAll calls each enabled slot refresh exactly once', async () => {
    vi.useFakeTimers();
    const workspaces = [makeWorkspace('machine-1', '/repo-a'), makeWorkspace('machine-2', '/repo-b')];
    const { result } = renderHook(() => useMultiWorkspaceFiles(workspaces));

    expect(mocks.requestFileTreeMutation).toHaveBeenCalledTimes(2);
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(1, {
      machineId: 'machine-1',
      workingDir: '/repo-a',
    });
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(2, {
      machineId: 'machine-2',
      workingDir: '/repo-b',
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    mocks.requestFileTreeMutation.mockClear();

    act(() => {
      result.current.refreshAll();
    });

    expect(mocks.requestFileTreeMutation).toHaveBeenCalledTimes(2);
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(1, {
      machineId: 'machine-1',
      workingDir: '/repo-a',
    });
    expect(mocks.requestFileTreeMutation).toHaveBeenNthCalledWith(2, {
      machineId: 'machine-2',
      workingDir: '/repo-b',
    });
  });
});
