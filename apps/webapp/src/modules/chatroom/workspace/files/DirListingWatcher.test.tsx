import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DirListingWatcher } from './useWorkspaceDirExplorer';

const mocks = vi.hoisted(() => ({
  entries: [] as { name: string; type: 'file' | 'directory' }[],
  isLoading: true,
  refresh: vi.fn(),
  useDirListing: vi.fn(),
}));

vi.mock('./useDirListing', () => ({
  useDirListing: (...args: unknown[]) => mocks.useDirListing(...args),
}));

const defaultProps = {
  machineId: 'machine-1',
  workingDir: '/workspace',
  dirPath: 'src',
  refreshToken: 0,
};

beforeEach(() => {
  mocks.refresh.mockClear();
  mocks.entries = [];
  mocks.isLoading = true;
  mocks.useDirListing.mockImplementation(() => ({
    entries: mocks.entries,
    isLoading: mocks.isLoading,
    refresh: mocks.refresh,
    scannedAt: null,
    truncated: false,
  }));
});

describe('DirListingWatcher', () => {
  it('reports listing updates once per meaningful entries change when refs are stable', () => {
    const onUpdate = vi.fn();

    const { rerender } = render(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);

    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith('src', mocks.entries, true);

    rerender(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);
    rerender(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);

    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('reports again when stable entries reference changes to loaded data', () => {
    const onUpdate = vi.fn();
    const loadedEntries = [{ name: 'index.ts', type: 'file' as const }];

    const { rerender } = render(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);
    expect(onUpdate).toHaveBeenCalledTimes(1);

    mocks.entries = loadedEntries;
    mocks.isLoading = false;
    rerender(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);

    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenLastCalledWith('src', loadedEntries, false);
  });

  it('re-fires onUpdate when useDirListing returns unstable empty array references', () => {
    const onUpdate = vi.fn();

    mocks.useDirListing.mockImplementation(() => ({
      entries: [],
      isLoading: true,
      refresh: mocks.refresh,
      scannedAt: null,
      truncated: false,
    }));

    const { rerender } = render(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);

    for (let i = 0; i < 10; i++) {
      rerender(<DirListingWatcher {...defaultProps} onUpdate={onUpdate} />);
    }

    // Documents why useDirListing must return stable refs: each new [] retriggers this effect.
    expect(onUpdate).toHaveBeenCalledTimes(11);
  });

  it('refreshes listing when refreshToken increments', () => {
    const onUpdate = vi.fn();

    const { rerender } = render(
      <DirListingWatcher {...defaultProps} refreshToken={0} onUpdate={onUpdate} />
    );

    rerender(<DirListingWatcher {...defaultProps} refreshToken={1} onUpdate={onUpdate} />);

    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
