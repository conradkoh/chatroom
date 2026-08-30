import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileSelector } from './useFileSelector';

const mockUseWorkspaceFileTree = vi.fn();
const mockUseWorkspaceFileTreeEntries = vi.fn();
const mockUseAcquireFileTreeWatch = vi.fn();
const mockGetFileSelectorOpen = vi.fn(() => true);

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: () => undefined,
}));
vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: { name: 'getPendingFileTreeRequests' },
    },
  },
}));

vi.mock('@/modules/chatroom/workspace/files/useWorkspaceFileTree', () => ({
  useWorkspaceFileTree: (...args: unknown[]) => mockUseWorkspaceFileTree(...args),
}));
vi.mock('@/modules/chatroom/workspace/files/useWorkspaceFileTreeEntries', () => ({
  useWorkspaceFileTreeEntries: (...args: unknown[]) => mockUseWorkspaceFileTreeEntries(...args),
}));
vi.mock('@/modules/chatroom/workspace/files/useFileTreeWatch', () => ({
  useAcquireFileTreeWatch: (...args: unknown[]) => mockUseAcquireFileTreeWatch(...args),
  useFileTreeWatchEnabled: () => true,
}));
vi.mock('@/modules/chatroom/context/contextManagedDialogsController', () => ({
  getFileSelectorOpen: () => mockGetFileSelectorOpen(),
  subscribeActiveContextManagedDialog: (cb: () => void) => {
    cb();
    return () => {};
  },
}));

describe('useFileSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: false,
      loadError: null,
      isNeverSynced: false,
      refresh: vi.fn(),
    });
    mockUseWorkspaceFileTreeEntries.mockReturnValue({
      entries: [],
      hasTree: false,
      refresh: vi.fn(),
    });
  });

  it('enables workspace file tree hydration when file selector is open', () => {
    renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(mockUseWorkspaceFileTree).toHaveBeenCalledWith({
      machineId: 'm1',
      workingDir: '/repo',
      enabled: true,
    });
    expect(mockUseWorkspaceFileTreeEntries).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, machineId: 'm1', workingDir: '/repo' })
    );
  });

  it('is not loading when hydration reports hasTree', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: true,
      isLoading: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.isLoading).toBe(false);
  });

  it('is not loading when tree hydration settled without store data', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: false,
      refresh: vi.fn(),
    });
    mockUseWorkspaceFileTreeEntries.mockReturnValue({
      entries: [],
      hasTree: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.isLoading).toBe(false);
  });

  it('is loading while tree hydration is in progress', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: true,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('exposes loadError from tree', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: false,
      loadError: 'File tree sync timed out',
      isNeverSynced: false,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.loadError).toMatch(/timed out/i);
  });

  it('reports isNeverSynced when tree never synced and no files', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: false,
      loadError: null,
      isNeverSynced: true,
      refresh: vi.fn(),
    });

    const { result } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.isNeverSynced).toBe(true);
  });

  it('does not infinite-loop when tree reference is unstable across rerenders', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockUseWorkspaceFileTree.mockImplementation(() => ({
      hasTree: false,
      isLoading: false,
      loadError: null,
      isNeverSynced: false,
      refresh: vi.fn(),
    }));

    const { rerender } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    for (let i = 0; i < 20; i++) {
      rerender();
    }

    const depthErrors = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes('Maximum update depth')
    );
    expect(depthErrors).toHaveLength(0);

    consoleError.mockRestore();
  });

  it('settles empty partition when tree hydration completes', () => {
    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: true,
      loadError: null,
      isNeverSynced: false,
      refresh: vi.fn(),
    });

    const { result, rerender } = renderHook(() =>
      useFileSelector({ chatroomId: 'room-1', machineId: 'm1', workingDir: '/repo' })
    );

    expect(result.current.isLoading).toBe(true);

    mockUseWorkspaceFileTree.mockReturnValue({
      hasTree: false,
      isLoading: false,
      loadError: null,
      isNeverSynced: false,
      refresh: vi.fn(),
    });
    rerender();

    expect(result.current.isLoading).toBe(false);
  });
});
