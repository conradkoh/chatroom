import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useRecoverInterruptedImport } from './useRecoverInterruptedImport';
import {
  INFLIGHT_IMPORT_STALE_MS,
  INFLIGHT_IMPORT_STORAGE_KEY,
  readInflightImport,
  writeInflightImport,
} from '../lib/inflightImport';

const mocks = vi.hoisted(() => ({ mutation: vi.fn() }));

vi.mock('convex/react', () => ({
  useConvex: () => ({ mutation: mocks.mutation }),
}));

vi.mock('convex-helpers/react/sessions', () => ({
  useSessionId: () => ['session-1'],
}));

vi.mock('@workspace/backend/convex/_generated/api', () => ({
  api: { chatroomImport: { rollback: { name: 'rollback' } } },
}));

const NOW = 2_000_000_000_000;

function writeStale(): void {
  window.localStorage.setItem(
    INFLIGHT_IMPORT_STORAGE_KEY,
    JSON.stringify({
      chatroomId: 'room-1',
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - INFLIGHT_IMPORT_STALE_MS - 1,
    })
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  mocks.mutation.mockReset();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('useRecoverInterruptedImport', () => {
  it('offers a record whose heartbeat is stale', () => {
    writeStale();
    const { result } = renderHook(() => useRecoverInterruptedImport());
    expect(result.current.pending).toEqual({
      chatroomId: 'room-1',
      startedAt: NOW - 60_000,
      heartbeatAt: NOW - INFLIGHT_IMPORT_STALE_MS - 1,
    });
    expect(result.current.state).toBe('idle');
  });

  it('never offers a record with a fresh heartbeat', () => {
    writeInflightImport('room-1', NOW);
    const { result } = renderHook(() => useRecoverInterruptedImport());
    expect(result.current.pending).toBeNull();
  });

  it('starts offering the record once polling sees it go stale', () => {
    writeInflightImport('room-1', NOW);
    const { result } = renderHook(() => useRecoverInterruptedImport());
    expect(result.current.pending).toBeNull();

    act(() => {
      vi.advanceTimersByTime(INFLIGHT_IMPORT_STALE_MS + 5_000);
    });
    expect(result.current.pending).not.toBeNull();
  });

  it('drains rollback until it reports drained, then clears the record', async () => {
    writeStale();
    mocks.mutation
      .mockResolvedValueOnce({ drained: false, deleted: 2 })
      .mockResolvedValueOnce({ drained: true, deleted: 1 });
    const { result } = renderHook(() => useRecoverInterruptedImport());

    await act(async () => {
      await result.current.remove();
    });

    expect(mocks.mutation).toHaveBeenCalledTimes(2);
    expect(mocks.mutation).toHaveBeenCalledWith(
      { name: 'rollback' },
      {
        sessionId: 'session-1',
        chatroomId: 'room-1',
      }
    );
    expect(result.current.state).toBe('removed');
    expect(result.current.pending).toBeNull();
    expect(readInflightImport()).toBeNull();
  });

  it('fails without clearing the record when a batch deletes nothing', async () => {
    writeStale();
    mocks.mutation.mockResolvedValue({ drained: false, deleted: 0 });
    const { result } = renderHook(() => useRecoverInterruptedImport());

    await act(async () => {
      await result.current.remove();
    });

    expect(result.current.state).toMatchObject({ failed: expect.any(String) });
    expect(readInflightImport()).not.toBeNull();
  });

  it('dismiss clears the record and the notice', async () => {
    writeStale();
    const { result } = renderHook(() => useRecoverInterruptedImport());

    act(() => result.current.dismiss());

    await waitFor(() => expect(result.current.pending).toBeNull());
    expect(result.current.state).toBe('idle');
    expect(readInflightImport()).toBeNull();
  });
});
