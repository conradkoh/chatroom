import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDirListing } from './useDirListing';

const mocks = vi.hoisted(() => ({
  raw: undefined as unknown,
  json: undefined as string | undefined,
  requestMutation: vi.fn(() => Promise.resolve()),
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
      getDirListingV2: 'getDirListingV2',
      requestDirListing: 'requestDirListing',
    },
  },
}));

const args = { machineId: 'machine-1', workingDir: '/workspace', dirPath: '' };

beforeEach(() => {
  mocks.raw = undefined;
  mocks.json = undefined;
  mocks.requestMutation.mockClear();
});

describe('useDirListing', () => {
  it('reuses the same empty entries reference while loading across rerenders', () => {
    const { result, rerender } = renderHook(() => useDirListing(args));

    expect(result.current.isLoading).toBe(true);
    const firstEntries = result.current.entries;

    rerender();
    rerender();
    rerender();

    expect(result.current.entries).toBe(firstEntries);
    expect(result.current.entries).toHaveLength(0);
  });

  it('reuses the same hook return object when loading state is unchanged', () => {
    const { result, rerender } = renderHook(() => useDirListing(args));

    const firstReturn = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(firstReturn);
  });

  it('reuses the same empty entries reference for an explicit empty listing', () => {
    mocks.raw = { scannedAt: 1, truncated: false };
    mocks.json = JSON.stringify({ entries: [] });

    const { result, rerender } = renderHook(() => useDirListing(args));

    expect(result.current.isLoading).toBe(false);
    const firstEntries = result.current.entries;

    rerender();
    rerender();

    expect(result.current.entries).toBe(firstEntries);
  });

  it('returns stable empty entries and no-op refresh when skipped', () => {
    const { result, rerender } = renderHook(() => useDirListing('skip'));

    const firstEntries = result.current.entries;
    rerender();

    expect(result.current.entries).toBe(firstEntries);
    expect(result.current.isLoading).toBe(false);

    result.current.refresh();
    expect(mocks.requestMutation).not.toHaveBeenCalled();
  });
});
