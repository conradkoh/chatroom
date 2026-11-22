import { renderHook } from '@testing-library/react';
import type { WorkspaceGitState } from '@workspace/backend/src/domain/types/workspace-git';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useOpenFileOnRemote } from './useOpenFileOnRemote';

const mockGitState = vi.hoisted(() => ({ value: { status: 'loading' } as WorkspaceGitState }));
const mockRequestGitRefresh = vi.hoisted(() => vi.fn());
const mockOpenExternalUrl = vi.hoisted(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => mockGitState.value,
  useSessionMutation: () => mockRequestGitRefresh,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaces: { getWorkspaceGitState: {} },
    machines: { requestGitRefresh: {} },
  },
}));

vi.mock('@/lib/navigation', () => ({
  openExternalUrl: mockOpenExternalUrl,
}));

const availableGitState: WorkspaceGitState = {
  status: 'available',
  branch: 'main',
  isDirty: false,
  diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
  openPullRequests: [],
  remotes: [{ name: 'origin', url: 'https://github.com/acme/app.git' }],
  commitsAhead: 0,
  commitsBehind: 0,
  updatedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGitState.value = { status: 'loading' };
  mockRequestGitRefresh.mockReset().mockResolvedValue(undefined);
});

describe('useOpenFileOnRemote', () => {
  it('returns an error and calls nothing when no workspace is connected', async () => {
    const { result } = renderHook(() => useOpenFileOnRemote('', '/workspace'));

    await expect(result.current.openFileOnRemote('src/index.ts')).resolves.toEqual({
      status: 'error',
      message: 'No workspace connected',
    });
    expect(mockRequestGitRefresh).not.toHaveBeenCalled();
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('requests a refresh and returns syncing while git state is loading', async () => {
    const { result } = renderHook(() => useOpenFileOnRemote('machine-1', '/workspace'));

    await expect(result.current.openFileOnRemote('src/index.ts')).resolves.toEqual({
      status: 'syncing',
      message: 'Syncing repository info — try again in a moment',
    });
    expect(mockRequestGitRefresh).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
    });
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });

  it('returns an error when the refresh request fails', async () => {
    mockRequestGitRefresh.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useOpenFileOnRemote('machine-1', '/workspace'));

    await expect(result.current.openFileOnRemote('src/index.ts')).resolves.toEqual({
      status: 'error',
      message: 'Failed to sync repository info',
    });
  });

  it('opens the origin file URL when git state is available', async () => {
    mockGitState.value = availableGitState;
    const { result } = renderHook(() => useOpenFileOnRemote('machine-1', '/workspace'));

    await expect(result.current.openFileOnRemote('src/index.ts')).resolves.toEqual({
      status: 'ok',
    });
    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      'https://github.com/acme/app/blob/main/src/index.ts'
    );
  });

  it('appends the selection as a text fragment', async () => {
    mockGitState.value = availableGitState;
    const { result } = renderHook(() => useOpenFileOnRemote('machine-1', '/workspace'));

    await result.current.openFileOnRemote('src/index.ts', 'const x = 1');

    expect(mockOpenExternalUrl).toHaveBeenCalledWith(
      'https://github.com/acme/app/blob/main/src/index.ts#:~:text=const%20x%20%3D%201'
    );
  });

  it('returns an error and requests a refresh when origin is missing', async () => {
    mockGitState.value = { ...availableGitState, remotes: [] };
    const { result } = renderHook(() => useOpenFileOnRemote('machine-1', '/workspace'));

    await expect(result.current.openFileOnRemote('src/index.ts')).resolves.toEqual({
      status: 'error',
      message: 'No remote repository URL found for origin',
    });
    expect(mockRequestGitRefresh).toHaveBeenCalledTimes(1);
    expect(mockOpenExternalUrl).not.toHaveBeenCalled();
  });
});
