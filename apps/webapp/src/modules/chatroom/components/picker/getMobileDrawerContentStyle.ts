import type { CSSProperties } from 'react';

function constrainedDrawerHeight(
  keyboardInsetPx: number,
  viewportOffsetTopPx: number,
  safeTop: string
): string {
  if (viewportOffsetTopPx > 0) {
    return `calc(100dvh - ${keyboardInsetPx}px - ${viewportOffsetTopPx}px - ${safeTop})`;
  }
  return `calc(100dvh - ${keyboardInsetPx}px - ${safeTop})`;
}

export function getMobileDrawerContentStyle(
  keyboardInsetPx: number,
  viewportOffsetTopPx = 0
): CSSProperties {
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

  if (keyboardInsetPx <= 0) {
    return style;
  }

  const height = constrainedDrawerHeight(keyboardInsetPx, viewportOffsetTopPx, safeTop);
  style.maxHeight = height;
  style.height = height;
  style.overflow = 'hidden';

  if (viewportOffsetTopPx > 0) {
    style.top = `calc(${viewportOffsetTopPx}px + ${safeTop})`;
    style.bottom = 'auto';
    style.marginTop = 0; // override data-[vaul-drawer-direction=bottom]:mt-24
  }

  return style;
}
