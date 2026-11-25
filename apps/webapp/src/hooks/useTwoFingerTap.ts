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
  positions: Map<number, TouchPoint>;
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
  return {
    startTime: Date.now(),
    positions: new Map(activeTouches),
    fingersStillDown: new Set(activeTouches.keys()),
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
  // Set when a gesture is aborted while fingers are still down. Those leftover
  // touches cannot start a new gesture until every finger has lifted.
  let blockedUntilIdle = false;

  const abortGesture = () => {
    gesture = null;
    blockedUntilIdle = activeTouches.size > 0;
  };

  const resetAll = () => {
    activeTouches.clear();
    gesture = null;
    blockedUntilIdle = false;
  };

  const tryStartGesture = () => {
    if (gesture || blockedUntilIdle || activeTouches.size !== 2) return;
    if (getJoinSpanMs(Array.from(activeTouches.values())) <= MAX_JOIN_MS) {
      gesture = createGesture(activeTouches);
    }
  };

  // fallow-ignore-next-line complexity
  const handleTouchStart = (e: TouchEvent) => {
    const active = gesture;
    addTouchesFromEvent(activeTouches, e);
    // A finger that is not part of the active gesture (a replacement for a
    // lifted finger, or a third finger) invalidates the gesture.
    const joinedActiveGesture =
      active !== null &&
      Array.from(e.changedTouches).some((touch) => !active.positions.has(touch.identifier));
    if (joinedActiveGesture || activeTouches.size > 2) {
      abortGesture();
      return;
    }
    tryStartGesture();
  };

  // fallow-ignore-next-line complexity
  const handleTouchMove = (e: TouchEvent) => {
    const active = gesture;
    if (!active) return;
    for (const touch of Array.from(e.changedTouches)) {
      if (!active.fingersStillDown.has(touch.identifier)) continue;
      if (hasExcessiveMovement(touch, active.positions.get(touch.identifier))) {
        abortGesture();
        return;
      }
    }
  };

  // fallow-ignore-next-line complexity
  const handleTouchEnd = (e: TouchEvent) => {
    const active = gesture;
    // Drop every lifted touch before any early exit, so no entry outlives its touchend.
    removeTouchesFromEvent(activeTouches, e);
    if (activeTouches.size === 0) blockedUntilIdle = false;
    if (!active) return;

    for (const touch of Array.from(e.changedTouches)) {
      if (!active.fingersStillDown.has(touch.identifier)) continue;
      // Each finger is checked at its own lift, so a drifted finger aborts the
      // gesture even when the other finger lifts last.
      if (hasExcessiveMovement(touch, active.positions.get(touch.identifier))) {
        abortGesture();
        return;
      }
      active.fingersStillDown.delete(touch.identifier);
    }

    if (active.fingersStillDown.size > 0) return;

    gesture = null;
    if (Date.now() - active.startTime > MAX_TAP_DURATION_MS) return;
    onTap();
  };

  return {
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleTouchCancel: resetAll,
  };
}

/**
 * Fires a callback when the user performs a two-finger tap.
 *
 * Detects staggered touchstart (finger 2 joins within MAX_JOIN_MS) and staggered
 * touchend (last finger lift completes the tap). Aborts on 3+ fingers, a finger
 * joining after another has lifted, excessive movement (checked at touchmove and
 * at each finger's own lift), or touchcancel. After an abort, leftover fingers
 * cannot start a new gesture until all fingers have lifted.
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
