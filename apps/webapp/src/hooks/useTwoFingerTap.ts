'use client';

import { useEffect, useRef } from 'react';

/** Maximum time from the first two-finger touchstart to the LAST finger lift (ms). */
const MAX_TAP_DURATION_MS = 500;

/** Maximum movement allowed for a tap (px). */
const MAX_TAP_MOVEMENT_PX = 10;

/**
 * Fires a callback when the user performs a two-finger tap.
 *
 * A two-finger tap is detected when:
 * 1. Two fingers touch the screen simultaneously
 * 2. Both fingers are lifted within MAX_TAP_DURATION_MS — measured from the
 *    first touchstart to the LAST finger lift, so staggered finger release
 *    (common on real devices) still counts as a tap
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
    // Tracks how many fingers from the two-finger gesture are still down, so a
    // staggered lift (finger 1 up, then finger 2 up) completes the tap on the
    // LAST lift instead of requiring both fingers up in the same touchend event.
    let activeFingerCount = 0;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        startTime = Date.now();
        activeFingerCount = 2;
        startTouches = Array.from(e.touches).map((t) => ({
          x: t.clientX,
          y: t.clientY,
        }));
      } else if (e.touches.length > 2) {
        // More than 2 fingers — abort this gesture
        activeFingerCount = 0;
        startTouches = [];
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (activeFingerCount === 0 || startTouches.length !== 2) return;

      // Decrement for each lifted finger in this event
      activeFingerCount = Math.max(0, activeFingerCount - e.changedTouches.length);

      if (activeFingerCount > 0) return; // still fingers down — wait for the last lift

      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_TAP_DURATION_MS) {
        startTouches = [];
        return;
      }

      // Check that fingers didn't move too much (using changedTouches)
      const endTouches = Array.from(e.changedTouches);
      if (endTouches.length < 1) return;

      const moved = endTouches.some((touch) => {
        // startTouches.length === 2 is guaranteed above, so start is defined.
        const start =
          startTouches.find(
            (s) => Math.abs(s.x - touch.clientX) < 50 && Math.abs(s.y - touch.clientY) < 50
          ) ?? startTouches[0];
        if (!start) return false;
        const dx = Math.abs(touch.clientX - start.x);
        const dy = Math.abs(touch.clientY - start.y);
        return dx > MAX_TAP_MOVEMENT_PX || dy > MAX_TAP_MOVEMENT_PX;
      });

      if (!moved) {
        callbackRef.current();
      }

      // Reset
      startTouches = [];
      activeFingerCount = 0;
    };

    const handleTouchCancel = () => {
      startTouches = [];
      activeFingerCount = 0;
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    document.addEventListener('touchcancel', handleTouchCancel, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('touchcancel', handleTouchCancel);
    };
  }, []);
}
