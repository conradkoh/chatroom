'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    /** Dev/e2e only — overrides keyboard inset when set (see /dev/mobile-picker-harness). */
    __PICKER_TEST_KEYBOARD_INSET__?: number;
  }
}

// fallow-ignore-next-line unused-export
export function computeKeyboardInsetPx(): number {
  if (typeof window === 'undefined') return 0;
  if (typeof window.__PICKER_TEST_KEYBOARD_INSET__ === 'number') {
    return Math.max(0, window.__PICKER_TEST_KEYBOARD_INSET__);
  }
  const vv = window.visualViewport;
  if (!vv) return 0;
  return Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
}

export function useVisualViewportKeyboardInset(enabled = true): number {
  const [insetPx, setInsetPx] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setInsetPx(0);
      return;
    }
    const update = () => setInsetPx(computeKeyboardInsetPx());
    update();
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    return () => {
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
    };
  }, [enabled]);

  if (!enabled) return 0;

  if (typeof window !== 'undefined' && typeof window.__PICKER_TEST_KEYBOARD_INSET__ === 'number') {
    return Math.max(0, window.__PICKER_TEST_KEYBOARD_INSET__);
  }

  return insetPx;
}
