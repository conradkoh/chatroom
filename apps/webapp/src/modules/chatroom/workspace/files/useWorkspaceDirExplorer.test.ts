import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceDirExplorer } from './useWorkspaceDirExplorer';
import {
  __resetWorkspaceFileTreeStoreForTests,
  toWorkspaceFileTreeKey,
  upsertWorkspaceFileTree,
  getWorkspaceFileTreeEntries,
} from '../stores/workspaceFileTreeStore';

const MACHINE_ID = 'machine-1';
const WORKING_DIR = '/workspace';
const WORKSPACE_KEY = toWorkspaceFileTreeKey(MACHINE_ID, WORKING_DIR);

const mocks = vi.hoisted(() => ({
  treeRefresh: vi.fn(),
  treeHydrationRefresh: vi.fn(),
  isLoading: false,
  hasTree: false,
  hydrationLoading: false,
  hydrationHasTree: false,
}));

vi.mock('./useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: () => {
    const entries = getWorkspaceFileTreeEntries(WORKSPACE_KEY);
    return {
      entries: [],
      treeEntries: entries,
      isLoading: mocks.isLoading,
      hasTree: mocks.hasTree,
      refresh: mocks.treeRefresh,
    };
  },
}));

vi.mock('./useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: vi.fn(() => ({
    isLoading: mocks.hydrationLoading,
    hasTree: mocks.hydrationHasTree,
    entries: [],
    rootNodes: [],
    scannedAt: null,
    refresh: mocks.treeHydrationRefresh,
    loadError: null,
  })),
}));

beforeEach(() => {
  mocks.treeRefresh.mockClear();
  mocks.treeHydrationRefresh.mockClear();
  mocks.isLoading = false;
  mocks.hasTree = false;
  mocks.hydrationLoading = false;
  mocks.hydrationHasTree = false;
  __resetWorkspaceFileTreeStoreForTests();
});

describe('useWorkspaceDirExplorer', () => {
  it('uses hydration hook loading state when it has tree data', () => {
    mocks.isLoading = true;
    mocks.hydrationHasTree = true;
    mocks.hydrationLoading = false;

    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({ machineId: MACHINE_ID, workingDir: WORKING_DIR })
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.hasTree).toBe(true);
  });
  it('builds full tree nodes from store entries', () => {
    upsertWorkspaceFileTree(
      WORKSPACE_KEY,
      [
        { path: 'src', type: 'directory' },
        { path: 'src/index.ts', type: 'file' },
        { path: 'README.md', type: 'file' },
      ],
      100
    );

    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
      })
    );

    expect(result.current.rootNodes).toHaveLength(2);
    expect(result.current.displayNodes).toHaveLength(2);
    const src = result.current.rootNodes.find((n) => n.path === 'src');
    expect(src?.children).toEqual([
      expect.objectContaining({ path: 'src/index.ts', type: 'file' }),
    ]);
  });

  it('uses client-side search filter in search mode', () => {
    upsertWorkspaceFileTree(
      WORKSPACE_KEY,
      [
        { path: 'src/App.tsx', type: 'file' },
        { path: 'docs/readme.md', type: 'file' },
      ],
      100
    );

    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
        searchQuery: 'app',
      })
    );

    expect(result.current.isSearchMode).toBe(true);
    expect(result.current.displayNodes).toEqual([
      expect.objectContaining({
        path: 'src',
        type: 'directory',
        children: [expect.objectContaining({ path: 'src/App.tsx', type: 'file' })],
      }),
    ]);
  });

  it('applies short filter to built tree nodes', () => {
    upsertWorkspaceFileTree(
      WORKSPACE_KEY,
      [
        { path: 'src', type: 'directory' },
        { path: 'src/index.ts', type: 'file' },
        { path: 'package.json', type: 'file' },
      ],
      100
    );

    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
        filterQuery: 'index',
      })
    );

    expect(result.current.displayNodes).toEqual([
      expect.objectContaining({
        path: 'src',
        children: [expect.objectContaining({ path: 'src/index.ts' })],
      }),
    ]);
  });

  it('refresh calls hydration and entries refresh with force', () => {
    const { result } = renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
      })
    );

    act(() => {
      result.current.refresh();
    });

    expect(mocks.treeHydrationRefresh).toHaveBeenCalledWith({ force: true });
    expect(mocks.treeRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('calls refresh when refreshSignal increments', () => {
    const { rerender } = renderHook(
      ({ refreshSignal }) =>
        useWorkspaceDirExplorer({
          machineId: MACHINE_ID,
          workingDir: WORKING_DIR,
          refreshSignal,
        }),
      { initialProps: { refreshSignal: 1 } }
    );

    mocks.treeRefresh.mockClear();

    rerender({ refreshSignal: 2 });

    expect(mocks.treeRefresh).toHaveBeenCalledWith({ force: true });
  });

  it('skips mount refresh when store is already hydrated', () => {
    mocks.hasTree = true;

    renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
        enabled: true,
      })
    );

    expect(mocks.treeRefresh).not.toHaveBeenCalled();
  });

  it('pulls tree on mount when store is empty', () => {
    mocks.hasTree = false;

    renderHook(() =>
      useWorkspaceDirExplorer({
        machineId: MACHINE_ID,
        workingDir: WORKING_DIR,
        enabled: true,
      })
    );

    expect(mocks.treeRefresh).toHaveBeenCalledWith();
  });
});
