'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    /** Dev/e2e only — overrides keyboard inset when set (see /dev/mobile-picker-harness). */
    __MOBILE_KEYBOARD_TEST_INSET__?: number;
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

export function useEditableElementFocused(enabled = true): boolean {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setFocused(false);
      return;
    }
    const update = () => setFocused(isEditableElementFocused());
    update();
    document.addEventListener('focusin', update, true);
    document.addEventListener('focusout', update, true);
    return () => {
      document.removeEventListener('focusin', update, true);
      document.removeEventListener('focusout', update, true);
    };
  }, [enabled]);

  return enabled ? focused : false;
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

export function useVisualViewportKeyboardInset(enabled = true): number {
  const [insetPx, setInsetPx] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInsetPx(0);
      return;
    }
    const update = () => setInsetPx(computeKeyboardInsetPx());
    let rafId: number | null = null;
    const timeoutIds: number[] = [];

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

    const scheduleUpdate = () => {
      clearPending();
      update();
      rafId = requestAnimationFrame(update);
      timeoutIds.push(window.setTimeout(update, 100));
      timeoutIds.push(window.setTimeout(update, 300));
    };

    scheduleUpdate();
    window.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('resize', scheduleUpdate);
    window.visualViewport?.addEventListener('scroll', scheduleUpdate);
    document.addEventListener('focusin', scheduleUpdate, true);
    document.addEventListener('focusout', scheduleUpdate, true);
    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('resize', scheduleUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleUpdate);
      document.removeEventListener('focusin', scheduleUpdate, true);
      document.removeEventListener('focusout', scheduleUpdate, true);
      clearPending();
    };
  }, [enabled]);

  if (!enabled) return 0;

  if (typeof window !== 'undefined' && typeof window.__MOBILE_KEYBOARD_TEST_INSET__ === 'number') {
    return Math.max(0, window.__MOBILE_KEYBOARD_TEST_INSET__);
  }

  return insetPx;
}
