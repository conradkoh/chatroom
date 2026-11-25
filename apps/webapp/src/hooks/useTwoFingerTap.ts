'use client';

import { useEffect, useRef } from 'react';

/** Maximum time between first and second finger touchstart to count as one gesture (ms). */
const MAX_JOIN_MS = 200;

/** Maximum time from gesture start (two fingers down) to last finger lift (ms). */
const MAX_TAP_DURATION_MS = 700;

/** Maximum movement allowed for a tap (px). */
const MAX_TAP_MOVEMENT_PX = 10;

type TouchPoint = { x: number; y: number; startTime: number };

type GestureState = {
  startTime: number;
  positions: Map<number, { x: number; y: number }>;
  fingersStillDown: Set<number>;
};

function getJoinSpanMs(points: TouchPoint[]): number {
  const times = points.map((p) => p.startTime);
  return Math.max(...times) - Math.min(...times);
}

function hasExcessiveMovement(touch: Touch, start: { x: number; y: number } | undefined): boolean {
  if (!start) return false;
  const dx = Math.abs(touch.clientX - start.x);
  const dy = Math.abs(touch.clientY - start.y);
  return dx > MAX_TAP_MOVEMENT_PX || dy > MAX_TAP_MOVEMENT_PX;
}

function createGesture(activeTouches: Map<number, TouchPoint>): GestureState {
  const ids = Array.from(activeTouches.keys());
  const positions = new Map<number, { x: number; y: number }>();
  for (const id of ids) {
    const point = activeTouches.get(id);
    if (point) positions.set(id, { x: point.x, y: point.y });
  }
  return {
    startTime: Date.now(),
    positions,
    fingersStillDown: new Set(ids),
  };
}

function addTouchesFromEvent(activeTouches: Map<number, TouchPoint>, e: TouchEvent): void {
  for (const touch of Array.from(e.changedTouches)) {
    activeTouches.set(touch.identifier, {
      x: touch.clientX,
      y: touch.clientY,
      startTime: Date.now(),
    });
  }
}

function removeTouchesFromEvent(activeTouches: Map<number, TouchPoint>, e: TouchEvent): void {
  for (const touch of Array.from(e.changedTouches)) {
    activeTouches.delete(touch.identifier);
  }
}

// fallow-ignore-next-line complexity
function createTwoFingerTapController(onTap: () => void) {
  const activeTouches = new Map<number, TouchPoint>();
  let gesture: GestureState | null = null;

  const clearGesture = () => {
    gesture = null;
  };

  const resetAll = () => {
    activeTouches.clear();
    clearGesture();
  };

  const tryStartGesture = () => {
    if (gesture || activeTouches.size !== 2) return;
    const points = Array.from(activeTouches.values());
    if (getJoinSpanMs(points) <= MAX_JOIN_MS) {
      gesture = createGesture(activeTouches);
    }
  };

  // fallow-ignore-next-line complexity
  const handleTouchStart = (e: TouchEvent) => {
    addTouchesFromEvent(activeTouches, e);
    if (gesture && activeTouches.size > 2) clearGesture();
    if (!gesture && activeTouches.size <= 2) tryStartGesture();
  };

  // fallow-ignore-next-line complexity
  const handleTouchMove = (e: TouchEvent) => {
    if (!gesture) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (!gesture.fingersStillDown.has(touch.identifier)) continue;
      if (hasExcessiveMovement(touch, gesture.positions.get(touch.identifier))) {
        clearGesture();
        return;
      }
    }
  };

  // fallow-ignore-next-line complexity
  const handleTouchEnd = (e: TouchEvent) => {
    const active = gesture;
    if (!active) {
      removeTouchesFromEvent(activeTouches, e);
      return;
    }

    for (const touch of Array.from(e.changedTouches)) {
      activeTouches.delete(touch.identifier);
      if (!active.fingersStillDown.has(touch.identifier)) continue;
      // Each finger is checked at its own lift, so a finger that drifted
      // aborts the gesture even when the other finger lifts last.
      if (hasExcessiveMovement(touch, active.positions.get(touch.identifier))) {
        clearGesture();
        return;
      }
      active.fingersStillDown.delete(touch.identifier);
    }

    if (active.fingersStillDown.size > 0) return;

    clearGesture();
    if (Date.now() - active.startTime > MAX_TAP_DURATION_MS) return;
    onTap();
  };

  const handleTouchCancel = () => {
    resetAll();
  };

  return { handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel };
}

/**
 * Fires a callback when the user performs a two-finger tap.
 *
 * Detects staggered touchstart (finger 2 joins within MAX_JOIN_MS) and staggered
 * touchend (last finger lift completes the tap). Aborts on 3+ fingers, excessive
 * movement (checked at touchmove and at each finger's own lift), or touchcancel.
 */
export function useTwoFingerTap(onTwoFingerTap: () => void): void {
  const callbackRef = useRef(onTwoFingerTap);
  callbackRef.current = onTwoFingerTap;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const controller = createTwoFingerTapController(() => callbackRef.current());
    const listenerOptions: AddEventListenerOptions = { passive: true, capture: true };

    document.addEventListener('touchstart', controller.handleTouchStart, listenerOptions);
    document.addEventListener('touchmove', controller.handleTouchMove, listenerOptions);
    document.addEventListener('touchend', controller.handleTouchEnd, listenerOptions);
    document.addEventListener('touchcancel', controller.handleTouchCancel, listenerOptions);

    return () => {
      document.removeEventListener('touchstart', controller.handleTouchStart, listenerOptions);
      document.removeEventListener('touchmove', controller.handleTouchMove, listenerOptions);
      document.removeEventListener('touchend', controller.handleTouchEnd, listenerOptions);
      document.removeEventListener('touchcancel', controller.handleTouchCancel, listenerOptions);
    };
  }, []);
}
