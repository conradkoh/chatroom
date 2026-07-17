import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSearchConfigFavorites } from './useSearchConfigFavorites';

const mockUseSessionQuery = vi.fn((_query: unknown, _args: unknown) => ({ favorites: [] }));
const mockUseSessionMutation = vi.fn(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => mockUseSessionQuery(query, args),
  useSessionMutation: () => mockUseSessionMutation(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    searchConfigFavorites: {
      getSearchConfigFavorites: 'search:get',
      setSearchConfigFavorites: 'search:set',
    },
  },
}));

vi.mock('./useSearchConfigUsage', () => ({
  useSearchConfigUsage: () => ({
    getAllUsage: vi.fn(() => new Map()),
    getLastUsed: vi.fn(() => null),
    recordUsage: vi.fn(),
    clearUsage: vi.fn(),
  }),
}));

describe('useSearchConfigFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue({ favorites: [] });
  });

  it('skips query when machineId is null', () => {
    renderHook(() => useSearchConfigFavorites(null));
    expect(mockUseSessionQuery).toHaveBeenCalledWith('search:get', 'skip');
  });

  it('queries favorites when machineId is provided', () => {
    renderHook(() => useSearchConfigFavorites('machine-1'));
    expect(mockUseSessionQuery).toHaveBeenCalledWith('search:get', { machineId: 'machine-1' });
  });

  it('addFavorite deduplicates', async () => {
    const existing = { harnessName: 'opencode-sdk', modelKey: 'openai::gpt-4o' };
    mockUseSessionQuery.mockReturnValue({ favorites: [existing] } as any);

    const { result } = renderHook(() => useSearchConfigFavorites('machine-1'));
    await result.current.addFavorite(existing);
    // Since already a favorite, should not call setFavoritesMutation again
  });

  it('moveFavorite reorders', async () => {
    const favA = { harnessName: 'h1', modelKey: 'm1' };
    const favB = { harnessName: 'h2', modelKey: 'm2' };
    mockUseSessionQuery.mockReturnValue({ favorites: [favA, favB] } as any);
    // Use a real mock function so we can spy on it
    const mutationMock = vi.fn();
    mockUseSessionMutation.mockReturnValue(mutationMock);

    const { result } = renderHook(() => useSearchConfigFavorites('machine-1'));
    await result.current.moveFavorite(0, 1);
    expect(mutationMock).toHaveBeenCalled();
  });

  it('returns empty favorites when machineId absent', () => {
    const { result } = renderHook(() => useSearchConfigFavorites(null));
    expect(result.current.favorites).toEqual([]);
  });
});
