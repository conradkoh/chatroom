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

    // 300ms > MAX_JOIN_MS (200): the two touches are too far apart to form a gesture
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

  it('does not fire when a resting finger is followed by a later tap (join window)', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 200, 100);
    // Finger 0 rests for 3s, then finger 1 taps — outside MAX_JOIN_MS (200).
    dispatchTouchEvent('touchstart', [a], [a]);
    advance(3000);
    dispatchTouchEvent('touchstart', [a, b], [b]);
    dispatchTouchEvent('touchend', [a], [b]);
    dispatchTouchEvent('touchend', [], [a]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when the first-lifted finger moved 120px (per-lift check)', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    // First finger lifts 120px below its start — must abort even though the
    // final lift (finger 1) is only 2px from its start.
    dispatchTouchEvent('touchend', [b], [makeTouch(0, 100, 220)]);
    dispatchTouchEvent('touchend', [], [makeTouch(1, 160, 102)]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('still fires when a finger jitters within 10px during the gesture', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchmove', [makeTouch(0, 105, 100), b], [makeTouch(0, 105, 100)]);
    dispatchTouchEvent('touchend', [], [makeTouch(0, 105, 100), b]);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not fire when a touchmove beyond 10px happens during the gesture', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchmove', [makeTouch(0, 100, 125), b], [makeTouch(0, 100, 125)]);
    dispatchTouchEvent('touchend', [], [makeTouch(0, 100, 125), b]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire after touchcancel mid-gesture', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchcancel', [], [a, b]);
    dispatchTouchEvent('touchend', [], [a, b]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('fires once on a clean tap after both fingers lift in one touchend with the first drifted', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    // One touchend lifts both: id 0 drifted 120px, then id 1 lifts in place.
    dispatchTouchEvent('touchend', [], [makeTouch(0, 100, 220), makeTouch(1, 160, 100)]);
    expect(callback).not.toHaveBeenCalled();

    // Fresh identifiers (iOS never reuses them) and a gap longer than MAX_JOIN_MS.
    advance(1000);
    const c = makeTouch(2, 300, 300);
    const d = makeTouch(3, 310, 310);
    dispatchTouchEvent('touchstart', [c, d], [c, d]);
    dispatchTouchEvent('touchend', [], [c, d]);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires on a clean tap after touchcancel', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 110, 110);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchcancel', [], [a, b]);

    twoFingerTap();

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('fires once per tap for two consecutive taps', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    twoFingerTap();
    twoFingerTap();

    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('does not fire when three fingers touch down in one touchstart', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 110, 110);
    const c = makeTouch(2, 120, 120);
    dispatchTouchEvent('touchstart', [a, b, c], [a, b, c]);
    dispatchTouchEvent('touchend', [], [a, b, c]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when a new finger lands after one finger lifted, even when the last original finger lifts', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    const c = makeTouch(2, 220, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchend', [b], [a]); // a lifts
    dispatchTouchEvent('touchstart', [b, c], [c]); // c lands while b is still down
    dispatchTouchEvent('touchend', [c], [b]); // b lifts, c still down
    expect(callback).not.toHaveBeenCalled();

    dispatchTouchEvent('touchend', [], [c]); // c lifts
    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire for a single-finger drag', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    dispatchTouchEvent('touchstart', [a], [a]);
    dispatchTouchEvent('touchmove', [makeTouch(0, 100, 220)], [makeTouch(0, 100, 220)]);
    dispatchTouchEvent('touchend', [], [makeTouch(0, 100, 220)]);

    expect(callback).not.toHaveBeenCalled();
  });

  it('does not fire when the second-lifted finger moved 120px (per-lift check)', () => {
    const callback = vi.fn();
    renderHook(() => useTwoFingerTap(callback));

    const a = makeTouch(0, 100, 100);
    const b = makeTouch(1, 160, 100);
    dispatchTouchEvent('touchstart', [a, b], [a, b]);
    dispatchTouchEvent('touchend', [b], [a]); // a lifts in place
    dispatchTouchEvent('touchend', [], [makeTouch(1, 160, 220)]); // b lifts 120px down

    expect(callback).not.toHaveBeenCalled();
  });
});
