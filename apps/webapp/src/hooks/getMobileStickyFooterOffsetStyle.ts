import type { CSSProperties } from 'react';

/** Lifts a sticky footer above the software keyboard on mobile. */
export function getMobileStickyFooterOffsetStyle(keyboardInsetPx: number): CSSProperties {
  if (keyboardInsetPx <= 0) return {};
  return { transform: `translateY(-${keyboardInsetPx}px)` };
}
