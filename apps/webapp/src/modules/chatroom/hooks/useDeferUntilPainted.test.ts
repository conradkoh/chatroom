import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { useDeferUntilPainted } from './useDeferUntilPainted';

describe('useDeferUntilPainted', () => {
  let nextRafId: number;
  const pendingRafs = new Map<number, FrameRequestCallback>();

  function runNextRaf() {
    const entry = pendingRafs.entries().next().value;
    if (!entry) return;
    const [id, cb] = entry;
    pendingRafs.delete(id);
    cb(performance.now());
  }

  function runAllRafs() {
    while (pendingRafs.size > 0) runNextRaf();
  }

  beforeEach(() => {
    nextRafId = 0;
    pendingRafs.clear();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      const id = ++nextRafId;
      pendingRafs.set(id, cb);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      pendingRafs.delete(id);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns false initially when enabled', () => {
    const { result } = renderHook(() => useDeferUntilPainted(true));
    expect(result.current).toBe(false);
  });

  it('returns true after two rAF ticks', () => {
    const { result } = renderHook(() => useDeferUntilPainted(true));
    act(() => {
      runAllRafs();
    });
    expect(result.current).toBe(true);
  });

  it('resets to false when disabled', () => {
    const { result, rerender } = renderHook(({ enabled }) => useDeferUntilPainted(enabled), {
      initialProps: { enabled: true },
    });
    act(() => {
      runAllRafs();
    });
    expect(result.current).toBe(true);
    rerender({ enabled: false });
    expect(result.current).toBe(false);
  });
});
