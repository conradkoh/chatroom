/**
 * Regression: @ autocomplete reads from workspaceFileTreeStore via useMultiWorkspaceFiles,
 * while useMultiWorkspaceFileTrees (producer) must not clear the store on unmount.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useMultiWorkspaceFiles } from './useMultiWorkspaceFiles';
import { useWorkspaceFileTree } from './useWorkspaceFileTree';
import { __resetWorkspaceFileTreeRefreshCoordinatorForTests } from './workspaceFileTreeRefreshCoordinator';
import {
  __resetWorkspaceFileTreeStoreForTests,
  getWorkspaceFileTreeEntries,
  toWorkspaceFileTreeKey,
} from './workspaceFileTreeStore';

import type { Workspace } from '@/modules/chatroom/types/workspace';

const mocks = vi.hoisted(() => ({
  manifest: null as null | undefined,
  checkpoint: null as null | undefined,
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
    if (query === 'getFileTreeShardsV3') return undefined;
    if (query === 'getFileTreeV2') return mocks.rawV2;
    if (query === 'getFileTreeCheckpoint') return mocks.checkpoint;
    if (query === 'getFileTreeDeltas') return undefined;
    return undefined;
  },
}));

vi.mock('../hooks/useDecompressedQueryJson', () => ({
  useDecompressedQueryJson: () => mocks.jsonV2,
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      getFileTreeManifestV3: 'getFileTreeManifestV3',
      getFileTreeShardsV3: 'getFileTreeShardsV3',
      getFileTreeV2: 'getFileTreeV2',
      getFileTreeCheckpoint: 'getFileTreeCheckpoint',
      getFileTreeDeltas: 'getFileTreeDeltas',
      requestFileTree: 'requestFileTree',
    },
  },
}));

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/repo';
const KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

const workspaces: Workspace[] = [
  {
    id: `${MACHINE_ID}::${WORKING_DIR}`,
    machineId: MACHINE_ID,
    hostname: 'host',
    workingDir: WORKING_DIR,
    agentRoles: [],
  },
];

function seedTreeInConvex() {
  mocks.manifest = null;
  mocks.rawV2 = { scannedAt: 1_700_000_000_000, data: { compression: 'gzip', content: 'abc' } };
  mocks.jsonV2 = JSON.stringify({
    entries: [
      { path: 'src/nested/deep.ts', type: 'file' },
      { path: 'src', type: 'directory' },
    ],
    scannedAt: 1_700_000_000_000,
    rootDir: WORKING_DIR,
  });
}

beforeEach(() => {
  __resetWorkspaceFileTreeRefreshCoordinatorForTests();
  __resetWorkspaceFileTreeStoreForTests();
  mocks.manifest = null;
  mocks.rawV2 = undefined;
  mocks.jsonV2 = undefined;
  mocks.requestMutation.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useMultiWorkspaceFiles @ autocomplete store integration', () => {
  it('exposes nested files from shared store after producer upserts tree', () => {
    seedTreeInConvex();

    const { unmount: unmountProducer } = renderHook(() =>
      useWorkspaceFileTree({ machineId: MACHINE_ID, workingDir: WORKING_DIR, enabled: true })
    );

    expect(getWorkspaceFileTreeEntries(KEY)).toHaveLength(2);

    const { result } = renderHook(() => useMultiWorkspaceFiles(workspaces));

    expect(result.current.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/nested/deep.ts', type: 'file' }),
        expect.objectContaining({ path: 'src', type: 'directory' }),
      ])
    );

    unmountProducer();
  });

  it('consumer still has files after producer unmount (store must not be cleared)', () => {
    seedTreeInConvex();

    const { unmount: unmountProducer } = renderHook(() =>
      useWorkspaceFileTree({ machineId: MACHINE_ID, workingDir: WORKING_DIR, enabled: true })
    );

    const { result, unmount: unmountConsumer } = renderHook(() =>
      useMultiWorkspaceFiles(workspaces)
    );

    expect(result.current.files.some((f) => f.path === 'src/nested/deep.ts')).toBe(true);

    unmountProducer();

    expect(getWorkspaceFileTreeEntries(KEY)).toHaveLength(2);

    const { result: resultAfterProducerUnmount } = renderHook(() =>
      useMultiWorkspaceFiles(workspaces)
    );

    expect(
      resultAfterProducerUnmount.current.files.some((f) => f.path === 'src/nested/deep.ts')
    ).toBe(true);

    unmountConsumer();
  });

  it('refreshAll on consumer requests tree reconciliation', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useMultiWorkspaceFiles(workspaces));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    mocks.requestMutation.mockClear();

    act(() => {
      result.current.refreshAll({ force: true });
    });

    expect(mocks.requestMutation).toHaveBeenCalledWith({
      machineId: MACHINE_ID,
      workingDir: WORKING_DIR,
      force: true,
    });
  });
});
