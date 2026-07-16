import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMachineConfigFavorites } from './useMachineConfigFavorites';

const mockUseSessionQuery = vi.fn((_query: unknown, _args: unknown) => ({ favorites: [] }));
const mockUseSessionMutation = vi.fn(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: (query: unknown, args: unknown) => mockUseSessionQuery(query, args),
  useSessionMutation: () => mockUseSessionMutation(),
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: {
    machines: {
      getMachineConfigFavorites: 'machines:getMachineConfigFavorites',
      setMachineConfigFavorites: 'machines:setMachineConfigFavorites',
    },
  },
}));

describe('useMachineConfigFavorites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSessionQuery.mockReturnValue({ favorites: [] });
  });

  it('skips query via args when machineId is undefined (not as query function)', () => {
    renderHook(() => useMachineConfigFavorites(undefined));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('machines:getMachineConfigFavorites', 'skip');
  });

  it('queries favorites when machineId is provided', () => {
    renderHook(() => useMachineConfigFavorites('machine-a'));

    expect(mockUseSessionQuery).toHaveBeenCalledWith('machines:getMachineConfigFavorites', {
      machineId: 'machine-a',
    });
  });
});
