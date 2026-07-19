import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTreeEntries } from './useWorkspaceFileTreeEntries';
import {
  __resetWorkspaceFileTreeStoreForTests,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
} from '../stores/workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
  deltaResult: undefined as
    | {
        status: 'ok';
        checkpointRevision: number;
        currentRevision: number;
        deltas: {
          baseRevision: number;
          revision: number;
          operations: (
            | {
                operation: 'add' | 'type-change';
                path: string;
                entryType: 'file' | 'directory';
              }
            | { operation: 'remove'; path: string }
          )[];
        }[];
        hasMore: boolean;
      }
    | null
    | undefined,
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (query === 'getFileTreeDeltas') return mocks.deltaResult;
    return undefined;
  },
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      requestFileTree: 'requestFileTree',
      getFileTreeDeltas: 'getFileTreeDeltas',
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
  mocks.deltaResult = undefined;
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

  it('treats an empty revisioned checkpoint as loaded', () => {
    upsertWorkspaceFileTree(KEY, [], 100, 0);

    const { result } = renderHook(() => useWorkspaceFileTreeEntries(args));

    expect(result.current.entries).toEqual([]);
    expect(result.current.hasTree).toBe(true);
    expect(result.current.isLoading).toBe(false);
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

  it('applies remove delta from store when delta sync receives remove operation', async () => {
    upsertWorkspaceFileTree(KEY, [{ path: 'test.md', type: 'file' }], 100, 1);
    mocks.deltaResult = {
      status: 'ok',
      checkpointRevision: 1,
      currentRevision: 2,
      deltas: [
        {
          baseRevision: 1,
          revision: 2,
          operations: [{ operation: 'remove', path: 'test.md' }],
        },
      ],
      hasMore: false,
    };

    const { result } = renderHook(() => useWorkspaceFileTreeEntries(args));

    await vi.waitFor(() => {
      expect(result.current.entries.find((e) => e.path === 'test.md')).toBeUndefined();
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
