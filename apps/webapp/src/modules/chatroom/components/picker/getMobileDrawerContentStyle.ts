import type { CSSProperties } from 'react';

export function getMobileDrawerContentStyle(keyboardInsetPx: number): CSSProperties {
  const safeTop = 'env(safe-area-inset-top, 0px)';
  const safeBottom = 'env(safe-area-inset-bottom, 0px)';
  const safeLeft = 'env(safe-area-inset-left, 0px)';
  const safeRight = 'env(safe-area-inset-right, 0px)';

  const paddingBottom =
    keyboardInsetPx > 0 ? `calc(${safeBottom} + 8px)` : `calc(${safeBottom} + 12px)`;

  const style: CSSProperties = {
    paddingLeft: `max(16px, ${safeLeft})`,
    paddingRight: `max(16px, ${safeRight})`,
    paddingBottom,
  };

  if (keyboardInsetPx > 0) {
    const constrainedHeight = `calc(100dvh - ${keyboardInsetPx}px - ${safeTop})`;
    style.maxHeight = constrainedHeight;
    style.height = constrainedHeight;
    style.overflow = 'hidden';
  }

  return style;
}
