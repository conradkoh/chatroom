import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';
import {
  __resetWorkspaceFileTreeStoreForTests,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from './workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileTree: 'requestFileTree',
    },
  },
}));

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

const args = { machineId: MACHINE_ID, workingDir: WORKING_DIR };

beforeEach(() => {
  __resetWorkspaceFileTreeStoreForTests();
  mocks.requestMutation.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspaceFileTreeEntries', () => {
  it('returns empty entries and no-op refresh when disabled', () => {
    const { result } = renderHook(() => useWorkspaceFileTreeEntries({ ...args, enabled: false }));

    expect(result.current.entries).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasTree).toBe(false);

    act(() => {
      result.current.refresh();
    });

    expect(mocks.requestMutation).not.toHaveBeenCalled();
  });

  it('reads store entries and filters to files when includeDirectories is false', () => {
    upsertWorkspaceFileTree(
      KEY,
      [
        { path: 'src/index.ts', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
      100
    );

    const { result } = renderHook(() => useWorkspaceFileTreeEntries(args));

    expect(result.current.entries).toEqual([{ path: 'src/index.ts', type: 'file' }]);
    expect(result.current.hasTree).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it('includes directories when includeDirectories is true', () => {
    upsertWorkspaceFileTree(
      KEY,
      [
        { path: 'src/index.ts', type: 'file' },
        { path: 'src', type: 'directory' },
      ],
      100
    );

    const { result } = renderHook(() =>
      useWorkspaceFileTreeEntries({ ...args, includeDirectories: true })
    );

    expect(result.current.entries).toEqual([
      { path: 'src/index.ts', type: 'file' },
      { path: 'src', type: 'directory' },
    ]);
  });

  it('refresh with force passes force to requestFileTree', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTreeEntries(args));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    mocks.requestMutation.mockClear();

    act(() => {
      result.current.refresh({ force: true });
    });

    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      force: true,
    });
  });

  it('dedupes refresh calls within 1500ms', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTreeEntries(args));

    act(() => {
      result.current.refresh();
      result.current.refresh();
    });

    expect(mocks.requestMutation).toHaveBeenCalledTimes(1);
  });
});
