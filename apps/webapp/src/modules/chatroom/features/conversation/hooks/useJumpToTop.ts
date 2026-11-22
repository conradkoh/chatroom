'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX,
  JUMP_TO_TOP_NEAR_TOP_PX,
  JUMP_TO_TOP_SHOW_UP_DISTANCE_PX,
  JUMP_TO_TOP_VISIBLE_MS,
} from '../../../components/timeline/timelineVirtualizerConfig';

type JumpState = {
  lastTop: number;
  upDistance: number;
  downDistance: number;
  suppressed: boolean;
  visible: boolean;
  paused: boolean;
};

type JumpToTopController = {
  state: JumpState;
  hide: () => void;
  show: () => void;
  arm: () => void;
  pause: () => void;
  resume: () => void;
  releaseSuppression: () => void;
  reset: () => void;
  beginJump: () => void;
};

/**
 * Owns the jump-to-top state machine outside the hook body so the visibility rules stay
 * readable: show after enough upward travel, re-arm on every upward nudge, hide on the
 * timer, a downward move, near-top, an anchor change or a click.
 */
function createJumpToTopController(setIsVisible: (visible: boolean) => void): JumpToTopController {
  const state: JumpState = {
    lastTop: 0,
    upDistance: 0,
    downDistance: 0,
    suppressed: false,
    visible: false,
    paused: false,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const hide = () => {
    clearTimer();
    state.visible = false;
    state.upDistance = 0;
    state.downDistance = 0;
    // SPEC FIX: a hidden button is not paused. Without this reset, hiding while hovered
    // leaves `paused` stuck true (mouseleave never fires on an unmounted button) and the
    // next appearance never auto-hides.
    state.paused = false;
    setIsVisible(false);
  };

  const arm = () => {
    clearTimer();
    if (state.paused) return;
    timer = setTimeout(hide, JUMP_TO_TOP_VISIBLE_MS);
  };

  const show = () => {
    state.visible = true;
    setIsVisible(true);
    arm();
  };

  const releaseSuppression = () => {
    state.suppressed = false;
  };

  return {
    state,
    hide,
    show,
    arm,
    pause: () => {
      state.paused = true;
      clearTimer();
    },
    resume: () => {
      state.paused = false;
      if (state.visible) arm();
    },
    releaseSuppression,
    reset: () => {
      releaseSuppression();
      hide();
    },
    beginJump: () => {
      state.suppressed = true;
      hide();
    },
  };
}

function handleUpward(controller: JumpToTopController, amount: number): void {
  controller.state.downDistance = 0;
  controller.state.upDistance += amount;
  if (!controller.state.visible) {
    if (controller.state.upDistance >= JUMP_TO_TOP_SHOW_UP_DISTANCE_PX) controller.show();
    return;
  }
  controller.arm(); // every upward movement re-arms, however small
}

function handleDownward(controller: JumpToTopController, amount: number): void {
  controller.state.upDistance = 0;
  controller.state.downDistance += amount;
  if (controller.state.downDistance >= JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX) controller.hide();
}

function applyDelta(controller: JumpToTopController, delta: number): void {
  if (delta < 0) handleUpward(controller, -delta);
  else handleDownward(controller, delta);
}

function trackScroll(controller: JumpToTopController, top: number, delta: number): void {
  if (top <= JUMP_TO_TOP_NEAR_TOP_PX) {
    controller.reset();
    return;
  }
  if (controller.state.suppressed || delta === 0) return;
  applyDelta(controller, delta);
}

function createScrollHandler(el: HTMLElement, controller: JumpToTopController): () => void {
  return () => {
    const top = el.scrollTop;
    const delta = top - controller.state.lastTop;
    controller.state.lastTop = top;
    trackScroll(controller, top, delta);
  };
}

function attachScrollTracking(el: HTMLElement, controller: JumpToTopController): () => void {
  controller.state.lastTop = el.scrollTop;
  const onScroll = createScrollHandler(el, controller);

  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('wheel', controller.releaseSuppression, { passive: true });
  el.addEventListener('touchmove', controller.releaseSuppression, { passive: true });
  return () => {
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('wheel', controller.releaseSuppression);
    el.removeEventListener('touchmove', controller.releaseSuppression);
    // SPEC FIX: hide (not just clear the timer). If the feed becomes empty while the button
    // is visible, the stale visible state must not reappear when events return.
    controller.hide();
  };
}

function scrollListToTop(el: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  el.focus({ preventScroll: true });
}

/**
 * Transient "Jump to top" affordance for the conversation feed.
 *
 * Visibility is derived from the list's own scroll events:
 * - show after at least {@link JUMP_TO_TOP_SHOW_UP_DISTANCE_PX} of accumulated upward
 *   movement while `scrollTop` is above {@link JUMP_TO_TOP_NEAR_TOP_PX};
 * - every further upward movement re-arms a {@link JUMP_TO_TOP_VISIBLE_MS} timer;
 * - hide on timer expiry, {@link JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX} downward movement,
 *   returning near the top, an anchor change, a click, or the feed becoming empty.
 *
 * Hover/focus pause the timer without hiding the button. After a click the hook is
 * suppressed until the programmatic scroll finishes (near the top) or the user takes
 * over with wheel/touch, so the button does not flash back during the smooth scroll.
 */
export function useJumpToTop({
  containerRef,
  enabled,
  resetKey,
}: {
  /** The scrolling list element (the same node the list owns). */
  containerRef: RefObject<HTMLElement | null>;
  /** false while the feed is empty; no listener is attached. */
  enabled: boolean;
  /** Any change (the anchorId) hides the button. */
  resetKey: string | null;
}): { isVisible: boolean; jumpToTop: () => void; pause: () => void; resume: () => void } {
  const [isVisible, setIsVisible] = useState(false);
  const controllerRef = useRef<JumpToTopController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = createJumpToTopController(setIsVisible);
  }
  const controller = controllerRef.current;

  useEffect(() => {
    const el = containerRef.current;
    if (!enabled || !el) return;
    return attachScrollTracking(el, controller);
  }, [containerRef, enabled, controller]);

  useEffect(() => {
    controller.reset();
  }, [resetKey, controller]);

  const jumpToTop = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    controller.beginJump();
    scrollListToTop(el);
  }, [containerRef, controller]);

  return {
    isVisible,
    jumpToTop,
    pause: controller.pause,
    resume: controller.resume,
  };
}
