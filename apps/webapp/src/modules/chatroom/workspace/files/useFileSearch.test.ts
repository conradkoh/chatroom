import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useFileSearch } from './useFileSearch';

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
      getFileSearchV2: 'getFileSearchV2',
      requestFileSearch: 'requestFileSearch',
    },
  },
}));

const args = { machineId: 'machine-1', workingDir: '/workspace', query: 'index' };

beforeEach(() => {
  mocks.raw = undefined;
  mocks.json = undefined;
  mocks.requestMutation.mockClear();
});

describe('useFileSearch', () => {
  it('reuses the same empty entries reference while loading across rerenders', () => {
    const { result, rerender } = renderHook(() => useFileSearch(args));

    expect(result.current.isLoading).toBe(true);
    const firstEntries = result.current.entries;

    rerender();
    rerender();
    rerender();

    expect(result.current.entries).toBe(firstEntries);
    expect(result.current.entries).toHaveLength(0);
  });

  it('reuses the same hook return object when search state is unchanged', () => {
    const { result, rerender } = renderHook(() => useFileSearch(args));

    const firstReturn = result.current;
    rerender();
    rerender();

    expect(result.current).toBe(firstReturn);
  });

  it('returns stable empty entries when skipped', () => {
    const { result, rerender } = renderHook(() => useFileSearch('skip'));

    const firstEntries = result.current.entries;
    rerender();

    expect(result.current.entries).toBe(firstEntries);
    expect(result.current.isLoading).toBe(false);
  });
});
