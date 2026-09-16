import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useDaemonConnected } from './useDaemonConnected';

const mockUseSessionQuery = vi.hoisted(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: mockUseSessionQuery,
}));

describe('useDaemonConnected', () => {
  beforeEach(() => {
    mockUseSessionQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a loading result before the status query resolves', () => {
    mockUseSessionQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: false, isLoading: true });
  });

  it('returns connected status for an online daemon', () => {
    mockUseSessionQuery.mockReturnValue({ connected: true });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: true, isLoading: false });
  });

  it('returns disconnected status for an offline daemon', () => {
    mockUseSessionQuery.mockReturnValue({ connected: false });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: false, isLoading: false });
  });

  it('does not apply client-side timestamp staleness to an online result', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'));
    mockUseSessionQuery.mockReturnValue({ connected: true });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: true, isLoading: false });
  });
});
