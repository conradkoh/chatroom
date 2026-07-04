/**
 * useDirListingWatch unit tests
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDirListingWatch } from './useDirListingWatch';

const mockObserve = vi.fn().mockResolvedValue({ observerCount: 1 });
const mockSetPaths = vi.fn().mockResolvedValue({ observerCount: 1, activeDirPaths: [''] });

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionMutation: vi.fn((apiRef: unknown) => {
    if (apiRef === 'setDirListingExplorerObserver') return mockObserve;
    if (apiRef === 'setDirListingWatchPaths') return mockSetPaths;
    return vi.fn();
  }),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    workspaceFiles: {
      setDirListingExplorerObserver: 'setDirListingExplorerObserver',
      setDirListingWatchPaths: 'setDirListingWatchPaths',
    },
  },
}));

const defaultArgs = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  activeDirPaths: [''],
};

describe('useDirListingWatch', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('skips mutations when disabled', () => {
    renderHook(() => useDirListingWatch({ ...defaultArgs, enabled: false }));

    expect(mockObserve).not.toHaveBeenCalled();
    expect(mockSetPaths).not.toHaveBeenCalled();
  });

  it('observes on mount', () => {
    renderHook(() => useDirListingWatch(defaultArgs));

    expect(mockObserve).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      observing: true,
    });
  });

  it('unobserves on unmount', () => {
    const { unmount } = renderHook(() => useDirListingWatch(defaultArgs));

    unmount();

    expect(mockObserve).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      observing: false,
    });
  });

  it('updates paths when activeDirPaths changes', () => {
    const { rerender } = renderHook(
      ({ activeDirPaths }) => useDirListingWatch({ ...defaultArgs, activeDirPaths }),
      { initialProps: { activeDirPaths: [''] as string[] } }
    );

    mockSetPaths.mockClear();

    rerender({ activeDirPaths: ['', 'src', 'src/foo'] });

    expect(mockSetPaths).toHaveBeenCalledWith({
      machineId: 'machine-1',
      workingDir: '/workspace',
      activeDirPaths: ['', 'src', 'src/foo'],
    });
  });
});
