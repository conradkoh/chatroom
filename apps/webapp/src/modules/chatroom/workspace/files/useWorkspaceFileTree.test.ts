import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import {
  __resetWorkspaceFileTreeStoreForTests,
  getWorkspaceFileTreeEntries,
  toWorkspaceFileTreeKey,
} from './workspaceFileTreeStore';

const mocks = vi.hoisted(() => ({
  manifest: null as
    | {
        syncGeneration: string;
        shardIds: string[];
        totalEntryCount: number;
        complete: boolean;
        scannedAt: number;
      }
    | null
    | undefined,
  shardsRaw: undefined as
    | {
        shardId: string;
        data: { compression: 'gzip'; content: string };
        dataHash: string;
        scannedAt: number;
        entryCount: number;
      }[]
    | null
    | undefined,
  rawV2: undefined as
    | { scannedAt: number; data: { compression: 'gzip'; content: string } }
    | null
    | undefined,
  jsonV2: undefined as string | null | undefined,
  requestMutation: vi.fn(() => Promise.resolve({ status: 'requested' })),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mocks.requestMutation,
  useSessionQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return undefined;
    if (query === 'getFileTreeManifestV3') return mocks.manifest;
    if (query === 'getFileTreeShardsV3') return mocks.shardsRaw;
    if (query === 'getFileTreeV2') return mocks.rawV2;
    return undefined;
  },
}));

vi.mock('../hooks/useDecompressedQueryJson', () => ({
  useDecompressedQueryJson: () => mocks.jsonV2,
}));

vi.mock('../utils/decompressGzip', () => ({
  decompressGzip: vi.fn(async (content: string) => {
    if (content === 'shard-a') {
      return JSON.stringify({
        entries: [{ path: 'src/a.ts', type: 'file' }],
        scannedAt: 1_700_000_000_000,
        rootDir: '/workspace',
      });
    }
    if (content === 'shard-b') {
      return JSON.stringify({
        entries: [{ path: 'src/b.ts', type: 'file' }],
        scannedAt: 1_700_000_000_000,
        rootDir: '/workspace',
      });
    }
    throw new Error(`unexpected shard content: ${content}`);
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      getFileTreeManifestV3: 'getFileTreeManifestV3',
      getFileTreeShardsV3: 'getFileTreeShardsV3',
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
  mocks.manifest = null;
  mocks.shardsRaw = undefined;
  mocks.rawV2 = undefined;
  mocks.jsonV2 = undefined;
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

  it('upserts parsed V2 tree into store when manifest is null', () => {
    mocks.manifest = null;
    mocks.rawV2 = { scannedAt: 1_700_000_000_000, data: { compression: 'gzip', content: 'abc' } };
    mocks.jsonV2 = JSON.stringify({
      entries: [{ path: 'README.md', type: 'file' }],
      scannedAt: 1_700_000_000_000,
      rootDir: WORKING_DIR,
    });

    const { result } = renderHook(() => useWorkspaceFileTree(args));

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'README.md', type: 'file' }]);
    expect(result.current.hasTree).toBe(true);
    expect(result.current.entries).toEqual([{ path: 'README.md', type: 'file' }]);
  });

  it('keeps store populated after producer unmount so @ consumers still see files', () => {
    mocks.manifest = null;
    mocks.rawV2 = { scannedAt: 100, data: { compression: 'gzip', content: 'abc' } };
    mocks.jsonV2 = JSON.stringify({
      entries: [{ path: 'README.md', type: 'file' }],
      scannedAt: 100,
      rootDir: WORKING_DIR,
    });

    const { unmount } = renderHook(() => useWorkspaceFileTree(args));

    expect(getWorkspaceFileTreeEntries(KEY)).toHaveLength(1);

    unmount();

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'README.md', type: 'file' }]);
  });

  it('uses V3 when manifest complete: merges shards into store', async () => {
    mocks.manifest = {
      syncGeneration: 'gen-v3',
      shardIds: ['src-a', 'src-b'],
      totalEntryCount: 2,
      complete: true,
      scannedAt: 1_700_000_000_000,
    };
    mocks.shardsRaw = [
      {
        shardId: 'src-a',
        data: { compression: 'gzip', content: 'shard-a' },
        dataHash: 'hash-a',
        scannedAt: 1_700_000_000_000,
        entryCount: 1,
      },
      {
        shardId: 'src-b',
        data: { compression: 'gzip', content: 'shard-b' },
        dataHash: 'hash-b',
        scannedAt: 1_700_000_000_000,
        entryCount: 1,
      },
    ];

    const { result } = renderHook(() => useWorkspaceFileTree(args));

    await waitFor(() => {
      expect(getWorkspaceFileTreeEntries(KEY)).toEqual([
        { path: 'src/a.ts', type: 'file' },
        { path: 'src/b.ts', type: 'file' },
      ]);
    });

    expect(result.current.hasTree).toBe(true);
    expect(result.current.entries).toEqual([
      { path: 'src/a.ts', type: 'file' },
      { path: 'src/b.ts', type: 'file' },
    ]);
  });

  it('uses V2 when manifest is null', () => {
    mocks.manifest = null;
    mocks.rawV2 = { scannedAt: 50, data: { compression: 'gzip', content: 'abc' } };
    mocks.jsonV2 = JSON.stringify({
      entries: [{ path: 'package.json', type: 'file' }],
      scannedAt: 50,
      rootDir: WORKING_DIR,
    });

    renderHook(() => useWorkspaceFileTree(args));

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([{ path: 'package.json', type: 'file' }]);
  });

  it('does not upsert store while manifest incomplete', async () => {
    mocks.manifest = {
      syncGeneration: 'gen-partial',
      shardIds: ['src'],
      totalEntryCount: 1,
      complete: false,
      scannedAt: 1_700_000_000_000,
    };
    mocks.shardsRaw = [
      {
        shardId: 'src',
        data: { compression: 'gzip', content: 'shard-a' },
        dataHash: 'hash-a',
        scannedAt: 1_700_000_000_000,
        entryCount: 1,
      },
    ];
    mocks.rawV2 = { scannedAt: 50, data: { compression: 'gzip', content: 'abc' } };
    mocks.jsonV2 = JSON.stringify({
      entries: [{ path: 'stale.json', type: 'file' }],
      scannedAt: 50,
      rootDir: WORKING_DIR,
    });

    const { result } = renderHook(() => useWorkspaceFileTree(args));

    await act(async () => {
      await Promise.resolve();
    });

    expect(getWorkspaceFileTreeEntries(KEY)).toEqual([]);
    expect(result.current.hasTree).toBe(false);
    expect(result.current.isLoading).toBe(true);
  });
});
