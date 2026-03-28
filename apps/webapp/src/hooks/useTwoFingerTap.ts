'use client';

import { useEffect, useRef } from 'react';

/** Maximum time between touchstart and touchend for a tap (ms). */
const MAX_TAP_DURATION_MS = 300;

/** Maximum movement allowed for a tap (px). */
const MAX_TAP_MOVEMENT_PX = 10;

/**
 * Fires a callback when the user performs a two-finger tap.
 *
 * A two-finger tap is detected when:
 * 1. Two fingers touch the screen simultaneously
 * 2. Both fingers are released within MAX_TAP_DURATION_MS
 * 3. Neither finger moves more than MAX_TAP_MOVEMENT_PX
 *
 * This provides a mobile-friendly shortcut (e.g. for Cmd+K on PWAs).
 */
export function useTwoFingerTap(onTwoFingerTap: () => void): void {
  const callbackRef = useRef(onTwoFingerTap);
  callbackRef.current = onTwoFingerTap;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let startTime = 0;
    let startTouches: { x: number; y: number }[] = [];

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startTime = Date.now();
        startTouches = Array.from(e.touches).map((t) => ({
          x: t.clientX,
          y: t.clientY,
        }));
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      // When both fingers are lifted, e.touches.length === 0
      if (e.touches.length !== 0) return;
      if (startTouches.length !== 2) return;

      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_TAP_DURATION_MS) return;

      // Check that fingers didn't move too much (using changedTouches)
      const endTouches = Array.from(e.changedTouches);
      if (endTouches.length < 1) return;

      const moved = endTouches.some((touch) => {
        const start = startTouches.find(
          (s) =>
            Math.abs(s.x - touch.clientX) < 50 && Math.abs(s.y - touch.clientY) < 50
        ) ?? startTouches[0]!;
        const dx = Math.abs(touch.clientX - start.x);
        const dy = Math.abs(touch.clientY - start.y);
        return dx > MAX_TAP_MOVEMENT_PX || dy > MAX_TAP_MOVEMENT_PX;
      });

      if (!moved) {
        callbackRef.current();
      }

      // Reset
      startTouches = [];
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, []);
}
