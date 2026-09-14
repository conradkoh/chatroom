import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnhancerConfigFavorites } from './useEnhancerConfigFavorites';

const mockMachineFavorites = vi.fn();

vi.mock('../../machine-config/hooks/useMachineConfigFavorites', () => ({
  useMachineConfigFavorites: (scope: unknown) => mockMachineFavorites(scope),
}));

describe('useEnhancerConfigFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMachineFavorites.mockReturnValue({
      favorites: [],
      addFavorite: vi.fn(),
      removeFavorite: vi.fn(),
      moveFavorite: vi.fn(),
      isFavorite: vi.fn(),
      isLoading: false,
    });
  });

  it('skips the shared favorites query when scope is undefined', () => {
    renderHook(() => useEnhancerConfigFavorites(undefined));
    expect(mockMachineFavorites).toHaveBeenCalledWith(undefined);
  });

  it('uses the shared machine/team/role scope for enhancer favorites', () => {
    const scope = { machineId: 'machine-a', chatroomId: 'room-1', teamId: 'duo', role: 'enhancer' };
    renderHook(() => useEnhancerConfigFavorites(scope));
    expect(mockMachineFavorites).toHaveBeenCalledWith(scope);
  });
});
