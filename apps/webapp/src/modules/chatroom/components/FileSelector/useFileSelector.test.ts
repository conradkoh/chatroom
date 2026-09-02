import { renderHook } from '@testing-library/react';
import type { FileTreeEntry } from '@workspace/backend/src/domain/entities/workspace-files';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileSelector } from './useFileSelector';

const mockRequestFileTree = vi.fn(() => Promise.resolve({ status: 'requested' }));
const mockGetFileSelectorOpen = vi.fn(() => true);
let storeEntries: FileTreeEntry[] = [];
let storeScannedAt: number | null = null;
let storeRevision: number | null = null;
const storeListeners = new Set<() => void>();

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: () => mockRequestFileTree,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { workspaceFiles: { requestFileTree: { name: 'requestFileTree' } } },
}));
vi.mock('@/modules/chatroom/context/contextManagedDialogsController', () => ({
  getFileSelectorOpen: () => mockGetFileSelectorOpen(),
  subscribeActiveContextManagedDialog: (callback: () => void) => {
    callback();
    return () => {};
  },
}));
vi.mock('@/modules/chatroom/workspace/stores/workspaceFileTreeStore', () => ({
  EMPTY_FILE_TREE_ENTRIES: [],
  getWorkspaceFileTreeEntries: () => storeEntries,
  getWorkspaceFileTreeRevision: () => storeRevision,
  getWorkspaceFileTreeScannedAt: () => storeScannedAt,
  subscribeWorkspaceFileTree: (_key: string, callback: () => void) => {
    storeListeners.add(callback);
    return () => storeListeners.delete(callback);
  },
  toWorkspaceFileTreeKey: (machineId: string, workingDir: string) => `${machineId}:${workingDir}`,
}));

describe('useFileSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetFileSelectorOpen.mockReturnValue(true);
    storeEntries = [];
    storeScannedAt = null;
    storeRevision = null;
    storeListeners.clear();
  });

  it('does not acquire a watch or subscribe to a producer', () => {
    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(mockRequestFileTree).toHaveBeenCalledTimes(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isNeverSynced).toBe(true);
  });

  it('returns a stable empty snapshot when workspace is unset (no infinite loop)', () => {
    const { result, rerender } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: null, workingDir: null })
    );

    expect(result.current.files).toEqual([]);
    rerender();
    rerender();
    expect(result.current.files).toEqual([]);
  });

  it('requests a tree only once when Cmd+P opens on a stale snapshot', () => {
    const { rerender } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    rerender();
    expect(mockRequestFileTree).toHaveBeenCalledTimes(1);
    expect(mockRequestFileTree).toHaveBeenCalledWith({
      machineId: 'm1',
      workingDir: '/repo',
    });
  });

  it('does not request when the cached snapshot is fresh', () => {
    storeEntries = [{ path: 'src/index.ts', type: 'file' }];
    storeRevision = 3;
    storeScannedAt = Date.now();

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(mockRequestFileTree).not.toHaveBeenCalled();
    expect(result.current.files).toEqual([{ path: 'src/index.ts', type: 'file' }]);
  });
});
