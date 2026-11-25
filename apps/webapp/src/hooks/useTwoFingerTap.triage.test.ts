import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTwoFingerTap } from './useTwoFingerTap';

const touch = (identifier: number, clientX: number, clientY: number) => ({
  identifier,
  clientX,
  clientY,
  target: document.body,
});

function fire(type: string, touches: unknown[], changedTouches: unknown[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches });
  act(() => {
    document.dispatchEvent(event);
  });
}

describe('useTwoFingerTap — master gaps vs robust branch (triage evidence)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('baseline: staggered touchstart (80ms) + simultaneous release fires', () => {
    const cb = vi.fn();
    renderHook(() => useTwoFingerTap(cb));
    const a = touch(0, 100, 100);
    const b = touch(1, 160, 100);
    fire('touchstart', [a], [a]);
    act(() => void vi.advanceTimersByTime(80));
    fire('touchstart', [a, b], [b]);
    fire('touchend', [], [a, b]);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('resting finger for 3s then second finger taps must NOT toggle (join window)', () => {
    const cb = vi.fn();
    renderHook(() => useTwoFingerTap(cb));
    const a = touch(0, 100, 100);
    const b = touch(1, 200, 100);
    fire('touchstart', [a], [a]);
    act(() => void vi.advanceTimersByTime(3000));
    fire('touchstart', [a, b], [b]);
    fire('touchend', [a], [b]);
    fire('touchend', [], [a]);
    expect(cb).not.toHaveBeenCalled();
  });

  it('two-finger swipe where first-lifted finger moved 120px must NOT toggle', () => {
    const cb = vi.fn();
    renderHook(() => useTwoFingerTap(cb));
    const a = touch(0, 100, 100);
    const b = touch(1, 160, 100);
    fire('touchstart', [a, b], [a, b]);
    const aEnd = touch(0, 100, 220);
    fire('touchend', [b], [aEnd]); // first finger lifts far away
    fire('touchend', [], [touch(1, 160, 102)]); // second ends near its start
    expect(cb).not.toHaveBeenCalled();
  });

  it('fires only once and state is clean after a touchcancel mid-gesture', () => {
    const cb = vi.fn();
    renderHook(() => useTwoFingerTap(cb));
    const a = touch(0, 100, 100);
    const b = touch(1, 160, 100);
    fire('touchstart', [a, b], [a, b]);
    fire('touchcancel', [], [a, b]);
    fire('touchend', [], [a, b]);
    expect(cb).not.toHaveBeenCalled();
  });
});
