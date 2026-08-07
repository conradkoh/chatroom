import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnhancerConfigFavorites } from './useEnhancerConfigFavorites';

const mockUseSessionQuery = vi.fn((_query: unknown, _args: unknown) => ({ favorites: [] }));
const mockUseSessionMutation = vi.fn(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => mockUseSessionQuery(query, args),
  useSessionMutation: () => mockUseSessionMutation(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    enhancerConfigFavorites: {
      getEnhancerConfigFavorites: 'enhancerConfigFavorites:getEnhancerConfigFavorites',
      setEnhancerConfigFavorites: 'enhancerConfigFavorites:setEnhancerConfigFavorites',
    },
  },
}));

describe('useEnhancerConfigFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue({ favorites: [] });
  });

  it('skips query when machineId is undefined', () => {
    renderHook(() => useEnhancerConfigFavorites(undefined));

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'enhancerConfigFavorites:getEnhancerConfigFavorites',
      'skip'
    );
  });

  it('skips query when machineId is null', () => {
    renderHook(() => useEnhancerConfigFavorites(null));

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'enhancerConfigFavorites:getEnhancerConfigFavorites',
      'skip'
    );
  });

  it('queries favorites when machineId is provided', () => {
    renderHook(() => useEnhancerConfigFavorites('machine-a'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith(
      'enhancerConfigFavorites:getEnhancerConfigFavorites',
      { machineId: 'machine-a' }
    );
  });
});
