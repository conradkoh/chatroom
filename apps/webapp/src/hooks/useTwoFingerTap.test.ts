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

/** Advance fake timers (also advances faked Date.now()). */
function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Simulates a two-finger tap where both fingers land together. With
 * `releaseStaggerMs > 0` the two fingers lift in separate touchend events
 * separated by `releaseStaggerMs`.
 */
function twoFingerTap(releaseStaggerMs = 0) {
  const t1 = makeTouch(0, 100, 100);
  const t2 = makeTouch(1, 110, 110);

  dispatchTouchEvent('touchstart', [t1, t2], [t1, t2]);

  if (releaseStaggerMs > 0) {
    // First finger lifts, second still down
    dispatchTouchEvent('touchend', [t2], [t1]);
    advance(releaseStaggerMs);
    // Second (last) finger lifts
    dispatchTouchEvent('touchend', [], [t2]);
  } else {
    dispatchTouchEvent('touchend', [], [t1, t2]);
  }
}

/**
 * Simulates a two-finger tap where finger 2 joins `joinMs` after finger 1.
 * With `releaseStaggerMs > 0` the fingers lift in separate touchend events.
 */
function staggeredTouchStartTap(joinMs: number, releaseStaggerMs = 0) {
  const t1 = makeTouch(0, 100, 100);
  const t2 = makeTouch(1, 110, 110);

  dispatchTouchEvent('touchstart', [t1], [t1]);
  advance(joinMs);
  dispatchTouchEvent('touchstart', [t1, t2], [t2]);

  if (releaseStaggerMs > 0) {
    dispatchTouchEvent('touchend', [t2], [t1]);
    advance(releaseStaggerMs);
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

  it('fires callback when fingers lift staggered within 700ms', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap(200);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires callback when finger 2 joins within MAX_JOIN_MS (staggered touchstart)', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    staggeredTouchStartTap(100);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires callback with staggered touchstart AND staggered touchend', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    staggeredTouchStartTap(100, 150);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire when finger 2 joins after MAX_JOIN_MS', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    // 300ms > MAX_JOIN_MS (200) — the pending join resets before finger 2 lands
    staggeredTouchStartTap(300);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire for single-finger tap', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    singleFingerTap();

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when staggered release exceeds 700ms', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap(800);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when a finger moves beyond MAX_TAP_MOVEMENT_PX during the gesture', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const t1 = makeTouch(0, 100, 100);
    const t2 = makeTouch(1, 110, 110);
    dispatchTouchEvent('touchstart', [t1, t2], [t1, t2]);
    // finger 1 moves 100px right during the gesture
    dispatchTouchEvent('touchmove', [t2, { ...t1, clientX: 200 }], [{ ...t1, clientX: 200 }]);
    dispatchTouchEvent('touchend', [], [t1, t2]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('aborts when a third finger joins during the gesture', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const t1 = makeTouch(0, 100, 100);
    const t2 = makeTouch(1, 110, 110);
    const t3 = makeTouch(2, 120, 120);
    dispatchTouchEvent('touchstart', [t1], [t1]);
    advance(100);
    dispatchTouchEvent('touchstart', [t1, t2], [t2]);
    // third finger joins
    dispatchTouchEvent('touchstart', [t1, t2, t3], [t3]);
    dispatchTouchEvent('touchend', [], [t1, t2, t3]);

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
