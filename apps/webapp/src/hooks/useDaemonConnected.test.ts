import { renderHook } from '@testing-library/react';
import { DAEMON_HEARTBEAT_TTL_MS } from '@workspace/backend/config/reliability';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { useDaemonConnected } from './useDaemonConnected';

const mockUseSessionQuery = vi.hoisted(() => vi.fn());

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionQuery: mockUseSessionQuery,
}));

const NOW = 1_700_000_000_000;

describe('useDaemonConnected', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mockUseSessionQuery.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns a loading result before the status query resolves', () => {
    mockUseSessionQuery.mockReturnValue(undefined);

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({
      isConnected: false,
      isLoading: true,
      lastSeenAt: null,
    });
  });

  it('returns connected status and the source timestamp for a fresh online daemon', () => {
    const lastSeenAt = NOW - 1_000;
    mockUseSessionQuery.mockReturnValue({ connected: true, lastSeenAt });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: true, isLoading: false, lastSeenAt });
  });

  it('marks an old online daemon disconnected while preserving its timestamp', () => {
    const lastSeenAt = NOW - DAEMON_HEARTBEAT_TTL_MS - 1;
    mockUseSessionQuery.mockReturnValue({ connected: true, lastSeenAt });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: false, isLoading: false, lastSeenAt });
  });

  it('returns an offline daemon status and its timestamp', () => {
    const lastSeenAt = NOW - 60_000;
    mockUseSessionQuery.mockReturnValue({ connected: false, lastSeenAt });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: false, isLoading: false, lastSeenAt });
  });

  it('returns null when an offline daemon has no liveness timestamp', () => {
    mockUseSessionQuery.mockReturnValue({ connected: false, lastSeenAt: null });

    const { result } = renderHook(() => useDaemonConnected('machine-a'));

    expect(result.current).toEqual({ isConnected: false, isLoading: false, lastSeenAt: null });
  });
});
