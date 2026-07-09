import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import {
  __resetWorkspaceFileTreeStoreForTests,
  getWorkspaceFileTreeEntries,
  toWorkspaceFileTreeKey,
} from './workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  raw: undefined as
    | { scannedAt: number; data: { compression: 'gzip'; content: string } }
    | null
    | undefined,
  json: undefined as string | null | undefined,
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
  useSessionQuery: () => mocks.raw,
}));

vi.mock('../hooks/useDecompressedQueryJson', () => ({
  useDecompressedQueryJson: () => mocks.json,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      getFileTreeV2: 'getFileTreeV2',
      requestFileTree: 'requestFileTree',
    },
  },
}));

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/workspace';
const KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

const args = { machineId: MACHINE_ID, workingDir: WORKING_DIR, enabled: true };

beforeEach(() => {
  __resetWorkspaceFileTreeStoreForTests();
  mocks.raw = undefined;
  mocks.json = undefined;
  mocks.requestMutation.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useWorkspaceFileTree', () => {
  it('requests tree on mount without force', async () => {
    vi.useFakeTimers();
    renderHook(() => useWorkspaceFileTree(args));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
    });
  });

  it('refresh with force passes force to requestFileTree', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWorkspaceFileTree(args));

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

  it('upserts parsed tree into store', () => {
    mocks.raw = { scannedAt: 1_700_000_000_000, data: { compression: 'gzip', content: 'abc' } };
    mocks.json = JSON.stringify({
      entries: [{ path: 'README.md', type: 'file' }],
      scannedAt: 1_700_000_000_000,
      rootDir: WORKING_DIR,
    });

    const { result } = renderHook(() => useWorkspaceFileTree(args));

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'README.md', type: 'file' }]);
    expect(result.current.hasTree).toBe(true);
    expect(result.current.entries).toEqual([{ path: 'README.md', type: 'file' }]);
  });

  it('clears store on disable', () => {
    mocks.raw = { scannedAt: 100, data: { compression: 'gzip', content: 'abc' } };
    mocks.json = JSON.stringify({
      entries: [{ path: 'README.md', type: 'file' }],
      scannedAt: 100,
      rootDir: WORKING_DIR,
    });

    const { rerender } = renderHook(({ enabled }) => useWorkspaceFileTree({ ...args, enabled }), {
      initialProps: { enabled: true },
    });

    expect(getWorkspaceFileTreeEntries(KEY)).toHaveLength(1);

    rerender({ enabled: false });

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([]);
  });
});
