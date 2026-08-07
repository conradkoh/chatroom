import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTwoFingerTap } from './useTwoFingerTap';

// ── jsdom does not implement Touch/TouchEvent — build plain event-like objects ──

function makeTouch(identifier: number, clientX: number, clientY: number) {
  return { identifier, clientX, clientY, target: document.body };
}

function makeTouchEvent(type: string, touches: unknown[], changedTouches: unknown[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true }) as Event & {
    touches: unknown[];
    targetTouches: unknown[];
    changedTouches: unknown[];
  };
  Object.defineProperty(event, 'touches', { value: touches, configurable: true });
  Object.defineProperty(event, 'targetTouches', { value: touches, configurable: true });
  Object.defineProperty(event, 'changedTouches', { value: changedTouches, configurable: true });
  return event;
}

function dispatchTouchEvent(type: string, touches: unknown[], changedTouches: unknown[]) {
  act(() => {
    document.dispatchEvent(makeTouchEvent(type, touches, changedTouches));
  });
}

/**
 * Simulates a two-finger tap. With `staggerMs > 0` the two fingers lift in
 * separate touchend events separated by `staggerMs` (advancing fake time).
 */
function twoFingerTap(staggerMs = 0) {
  const t1 = makeTouch(0, 100, 100);
  const t2 = makeTouch(1, 110, 110);

  dispatchTouchEvent('touchstart', [t1, t2], [t1, t2]);

  if (staggerMs > 0) {
    // First finger lifts, second still down
    dispatchTouchEvent('touchend', [t2], [t1]);
    act(() => {
      vi.advanceTimersByTime(staggerMs);
    });
    // Second (last) finger lifts
    dispatchTouchEvent('touchend', [], [t2]);
  } else {
    dispatchTouchEvent('touchend', [], [t1, t2]);
  }
}

function singleFingerTap() {
  const t1 = makeTouch(0, 100, 100);
  dispatchTouchEvent('touchstart', [t1], [t1]);
  dispatchTouchEvent('touchend', [], [t1]);
}

describe('useTwoFingerTap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires callback on simultaneous two-finger tap', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires callback when fingers lift staggered within 500ms', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap(200);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire for single-finger tap', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    singleFingerTap();

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when staggered release exceeds 500ms', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap(600);

    expect(callback).not.toHaveBeenCalled();
  });

  it('uses the latest callback (not the initial render closure)', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useTwoFingerTap(cb), {
      initialProps: { cb: first },
    });
    rerender({ cb: second });

    twoFingerTap();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
