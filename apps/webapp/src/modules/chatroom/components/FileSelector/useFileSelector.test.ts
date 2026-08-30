import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileSelector } from './useFileSelector';

const mockUseWorkspaceFileTree = vi.fn();
const mockUseWorkspaceFileTreeEntries = vi.fn();
const mockUseAcquireFileTreeWatch = vi.fn();
const mockGetFileSelectorOpen = vi.fn(() => true);

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
});
