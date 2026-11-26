'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import {
  JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX,
  JUMP_TO_TOP_NEAR_TOP_PX,
  JUMP_TO_TOP_SHOW_UP_DISTANCE_PX,
  JUMP_TO_TOP_VISIBLE_MS,
} from '../../../components/timeline/timelineVirtualizerConfig';

/**
 * After a wheel, touchmove, keydown or pointerdown on the list, upward scroll counts as
 * user-driven for this long. Each input refreshes the window.
 */
const USER_SCROLL_WINDOW_MS = 300;

type JumpState = {
  lastTop: number;
  upDistance: number;
  downDistance: number;
  suppressed: boolean;
  visible: boolean;
  /** Active hover/focus holds on the button: mouseEnter and focus add one, mouseLeave and blur remove one. */
  holds: number;
  /** A user input on the list opened the user-input window (see USER_SCROLL_WINDOW_MS). */
  userInputActive: boolean;
  /** A pointer is held down on the list (scrollbar drag, selection drag). Cleared by window pointerup. */
  pointerHeld: boolean;
};

type JumpToTopController = {
  state: JumpState;
  hide: () => void;
  show: () => void;
  arm: () => void;
  pause: () => void;
  resume: () => void;
  releaseSuppression: () => void;
  markUserInput: () => void;
  setPointerHeld: (held: boolean) => void;
  reset: () => void;
  beginJump: () => void;
  dispose: () => void;
};

/**
 * Owns the jump-to-top state machine outside the hook body so the visibility rules stay
 * readable: show after enough user-driven upward travel, re-arm on every upward nudge, hide
 * on the timer, a downward move, near-top, a page change or a click.
 */
function createJumpToTopController(setIsVisible: (visible: boolean) => void): JumpToTopController {
  const state: JumpState = {
    lastTop: 0,
    upDistance: 0,
    downDistance: 0,
    suppressed: false,
    visible: false,
    holds: 0,
    userInputActive: false,
    pointerHeld: false,
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inputTimer: ReturnType<typeof setTimeout> | null = null;

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
    // A hidden button cannot be hovered or focused. Its mouseleave and blur never fire once it
    // unmounts, so the holds are dropped here; otherwise the next appearance never auto-hides.
    state.holds = 0;
    setIsVisible(false);
  };

  const arm = () => {
    clearTimer();
    // While the button is hovered or focused, its timer must not run.
    if (state.holds > 0) return;
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

  const markUserInput = () => {
    releaseSuppression();
    state.userInputActive = true;
    if (inputTimer !== null) clearTimeout(inputTimer);
    inputTimer = setTimeout(() => {
      inputTimer = null;
      state.userInputActive = false;
    }, USER_SCROLL_WINDOW_MS);
  };

  return {
    state,
    hide,
    show,
    arm,
    pause: () => {
      state.holds += 1;
      clearTimer();
    },
    resume: () => {
      state.holds = Math.max(0, state.holds - 1);
      if (state.visible) arm();
    },
    releaseSuppression,
    markUserInput,
    setPointerHeld: (held) => {
      state.pointerHeld = held;
    },
    reset: () => {
      releaseSuppression();
      hide();
    },
    beginJump: () => {
      state.suppressed = true;
      hide();
    },
    dispose: () => {
      hide();
      if (inputTimer !== null) {
        clearTimeout(inputTimer);
        inputTimer = null;
      }
      state.userInputActive = false;
      state.pointerHeld = false;
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
  controller.arm(); // every user upward movement re-arms, however small
}

function handleDownward(controller: JumpToTopController, amount: number): void {
  controller.state.upDistance = 0;
  controller.state.downDistance += amount;
  if (controller.state.downDistance >= JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX) controller.hide();
}

// Four guards (near-top, suppressed, direction, user input) express the visibility contract;
// fallow's CRAP score is inflated because it excludes the test files from coverage.
// fallow-ignore-next-line complexity
function trackScroll(controller: JumpToTopController, top: number, delta: number): void {
  if (top <= JUMP_TO_TOP_NEAR_TOP_PX) {
    controller.reset();
    return;
  }
  if (controller.state.suppressed || delta === 0) return;
  if (delta > 0) {
    // Downward movement from any source (user, "Jump to new messages", scroll adjustment) may hide.
    handleDownward(controller, delta);
    return;
  }
  // Upward movement only counts when the user caused it. The browser moves scrollTop by itself
  // when the container is clamped (resize) or scroll anchoring shifts content above the viewport.
  const userDriven = controller.state.userInputActive || controller.state.pointerHeld;
  if (!userDriven) return;
  handleUpward(controller, -delta);
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
  const onPointerDown = () => {
    controller.setPointerHeld(true);
    controller.markUserInput();
  };
  const onPointerRelease = () => controller.setPointerHeld(false);

  el.addEventListener('scroll', onScroll, { passive: true });
  el.addEventListener('wheel', controller.markUserInput, { passive: true });
  el.addEventListener('touchmove', controller.markUserInput, { passive: true });
  el.addEventListener('keydown', controller.markUserInput);
  el.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointerup', onPointerRelease);
  window.addEventListener('pointercancel', onPointerRelease);
  return () => {
    el.removeEventListener('scroll', onScroll);
    el.removeEventListener('wheel', controller.markUserInput);
    el.removeEventListener('touchmove', controller.markUserInput);
    el.removeEventListener('keydown', controller.markUserInput);
    el.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerRelease);
    window.removeEventListener('pointercancel', onPointerRelease);
    // Hide on teardown and clear the input window, so a visible state cannot outlive the feed.
    controller.dispose();
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
 *   movement that the user caused (wheel, touch, keyboard or pointer on the list), while
 *   `scrollTop` is above {@link JUMP_TO_TOP_NEAR_TOP_PX};
 * - every further user upward movement re-arms a {@link JUMP_TO_TOP_VISIBLE_MS} timer;
 * - hide on timer expiry, {@link JUMP_TO_TOP_HIDE_DOWN_DISTANCE_PX} downward movement,
 *   returning near the top, a page change, a click, or the feed becoming empty.
 *
 * Hover and focus each hold the timer (counted separately) without hiding the button. After
 * a click the hook is suppressed until the programmatic scroll finishes (near the top) or the
 * user takes over with any input on the list.
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
  /** Any change (the pageId) hides the button. */
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
