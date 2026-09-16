import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useUserMachines } from './useUserMachines';

const mockUseSessionQuery = vi.hoisted(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: mockUseSessionQuery,
}));

describe('useUserMachines', () => {
  beforeEach(() => {
    mockUseSessionQuery.mockReset();
  });

  it('returns an empty list while the registry query is loading', () => {
    mockUseSessionQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useUserMachines());

    expect(result.current).toEqual({ machines: [], isLoading: true });
  });

  it('returns the narrow machine registry result after loading', () => {
    const machines = [
      {
        machineId: 'machine-a',
        hostname: 'host-a',
        alias: 'Laptop',
        os: 'darwin',
        registeredAt: 123,
      },
    ];
    mockUseSessionQuery.mockReturnValue({ machines });

    const { result } = renderHook(() => useUserMachines());

    expect(result.current).toEqual({ machines, isLoading: false });
  });
});
