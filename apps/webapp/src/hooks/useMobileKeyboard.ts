'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    /** Dev/e2e only — overrides keyboard inset when set (see /dev/mobile-picker-harness). */
    __MOBILE_KEYBOARD_TEST_INSET__?: number;
    /** Dev/e2e only — overrides visualViewport.offsetTop when set (see /dev/mobile-picker-harness). */
    __MOBILE_KEYBOARD_TEST_OFFSET_TOP__?: number;
  }
}

const NON_EDITABLE_INPUT_TYPES = new Set(['hidden', 'checkbox', 'radio', 'file']);

function isEditableTextArea(el: HTMLTextAreaElement): boolean {
  return !el.readOnly && !el.disabled;
}

function isEditableInput(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly) return false;
  return !NON_EDITABLE_INPUT_TYPES.has(el.type);
}

function isContentEditableTarget(el: HTMLElement): boolean {
  if (el.isContentEditable === true) return true;
  const mode = el.contentEditable;
  return mode === 'true' || mode === 'plaintext-only';
}

// fallow-ignore-next-line complexity
function isEditableElementFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;

  if (el instanceof HTMLTextAreaElement) return isEditableTextArea(el);
  if (el instanceof HTMLInputElement) return isEditableInput(el);
  return isContentEditableTarget(el);
}

/** Shared focus tracking — fires on focusin/focusout while enabled. */
function useFocusWithin(check: () => boolean, enabled = true): boolean {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setFocused(false);
      return;
    }
    const update = () => setFocused(check());
    update();
    document.addEventListener('focusin', update, true);
    document.addEventListener('focusout', update, true);
    return () => {
      document.removeEventListener('focusin', update, true);
      document.removeEventListener('focusout', update, true);
    };
  }, [enabled, check]);

  return enabled ? focused : false;
}

// fallow-ignore-next-line unused-export
export function useEditableElementFocused(enabled = true): boolean {
  return useFocusWithin(isEditableElementFocused, enabled);
}

// fallow-ignore-next-line unused-export
export function computeKeyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0;
  if (typeof window.__MOBILE_KEYBOARD_TEST_INSET__ === 'number') {
    return Math.max(0, window.__MOBILE_KEYBOARD_TEST_INSET__);
  }
  const vv = window.visualViewport;
  if (!vv) return 0;
  const layoutHeight = document.documentElement.clientHeight;
  return Math.max(0, Math.round(layoutHeight - vv.height - vv.offsetTop));
}

/**
 * How far the browser scrolled the layout viewport to keep the focused element
 * visible above the software keyboard. 0 when no keyboard scroll is active.
 */
// fallow-ignore-next-line unused-export
export function computeVisualViewportOffsetTopPx(): number {
  if (typeof window === 'undefined') return 0;
  if (typeof window.__MOBILE_KEYBOARD_TEST_OFFSET_TOP__ === 'number') {
    return Math.max(0, window.__MOBILE_KEYBOARD_TEST_OFFSET_TOP__);
  }
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(vv.offsetTop));
}

/**
 * Current visualViewport.scale: the pinch-zoom factor, 1 at rest and >1 when zoomed.
 * Lets callers tell a keyboard occlusion apart from a pinch-zoom shrink.
 */
// fallow-ignore-next-line unused-export
export function computeVisualViewportScale(): number {
  if (typeof window === 'undefined') return 1;
  const vv = window.visualViewport;
  if (!vv || typeof vv.scale !== 'number') return 1;
  return vv.scale;
}

/**
 * After a resize or focus change, visualViewport scroll events keep refreshing a
 * keyboard-derived value for this long. That covers the browser's scroll-into-view as the
 * keyboard opens. Later scrolls are user pans and must not move the value.
 */
const KEYBOARD_SCROLL_FOLLOW_MS = 600;

/**
 * Shared subscription for visualViewport-derived metrics (keyboard inset,
 * offset top). Recomputes on resize/focus changes with rAF + delayed
 * rechecks to catch late browser layout settles. Scroll events refresh the value only
 * while `scrollFollowMs` after the last resize/focus trigger has not elapsed; the default
 * is unbounded, so scroll always refreshes.
 */
function useVisualViewportValue(
  enabled: boolean,
  compute: () => number,
  scrollFollowMs = Number.POSITIVE_INFINITY
): number {
  const [valuePx, setValuePx] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setValuePx(0);
      return;
    }
    const update = () => setValuePx(compute());
    let rafId: number | null = null;
    const timeoutIds: number[] = [];
    let scrollFollowUntil = 0;

    const clearPending = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      for (const id of timeoutIds) {
        clearTimeout(id);
      }
      timeoutIds.length = 0;
    };

    const refresh = () => {
      clearPending();
      update();
      rafId = requestAnimationFrame(update);
      timeoutIds.push(window.setTimeout(update, 100));
      timeoutIds.push(window.setTimeout(update, 300));
    };

    // Resize and focus changes re-arm the follow window, then refresh.
    const scheduleUpdate = () => {
      scrollFollowUntil = Date.now() + scrollFollowMs;
      refresh();
    };

    // Default (unbounded) window: scroll runs the same refresh schedule as resize and focus.
    // Bounded window (bottom-bar lift): scroll takes one read while the window is open, and
    // never re-arms the window or schedules trailing rechecks.
    const handleScroll = () => {
      if (scrollFollowMs === Number.POSITIVE_INFINITY) {
        refresh();
      } else if (Date.now() < scrollFollowUntil) {
        update();
      }
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', handleScroll);
    document.addEventListener('focusin', scheduleUpdate, true);
    document.addEventListener('focusout', scheduleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', handleScroll);
      document.removeEventListener('focusin', scheduleUpdate, true);
      document.removeEventListener('focusout', scheduleUpdate, true);
      clearPending();
    };
  }, [enabled, compute, scrollFollowMs]);

  return enabled ? valuePx : 0;
}

export function useVisualViewportKeyboardInset(
  enabled = true,
  scrollFollowMs = Number.POSITIVE_INFINITY
): number {
  const insetPx = useVisualViewportValue(enabled, computeKeyboardInsetPx, scrollFollowMs);

  if (typeof window !== 'undefined' && typeof window.__MOBILE_KEYBOARD_TEST_INSET__ === 'number') {
    return Math.max(0, window.__MOBILE_KEYBOARD_TEST_INSET__);
  }

  return insetPx;
}

export function useVisualViewportOffsetTop(enabled = true): number {
  return useVisualViewportValue(enabled, computeVisualViewportOffsetTopPx);
}

/**
 * Live pinch-zoom factor from the shared visualViewport subscription.
 * Returns 0 while disabled or before the first measurement. Callers treat any value
 * <= 1.01 as "not zoomed", so 0 is safe.
 */
export function useVisualViewportScale(enabled = true): number {
  return useVisualViewportValue(enabled, computeVisualViewportScale);
}

/** Root selector marking the main chat composer — footer keyboard lift keys off this. */
// fallow-ignore-next-line unused-export
export const MAIN_CHAT_COMPOSER_SELECTOR = '[data-main-chat-composer]';

/** True when the focused element is inside the main chat composer (not a dialog input). */
// fallow-ignore-next-line unused-export
export function isMainChatComposerFocused(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el || !(el instanceof HTMLElement)) return false;
  return el.closest(MAIN_CHAT_COMPOSER_SELECTOR) !== null;
}

/** Mirrors useEditableElementFocused but scoped to the main chat composer root. */
export function useMainChatComposerFocused(enabled = true): boolean {
  return useFocusWithin(isMainChatComposerFocused, enabled);
}

/**
 * Keyboard inset for the bottom bar lift — only non-zero when the main chat composer has focus.
 * Latches once the keyboard settles: a user pan after that does not re-lift the footer.
 */
export function useMainChatComposerKeyboardInset(enabled = true): number {
  const inset = useVisualViewportKeyboardInset(enabled, KEYBOARD_SCROLL_FOLLOW_MS);
  const composerFocused = useMainChatComposerFocused(enabled);
  return composerFocused ? inset : 0;
}
