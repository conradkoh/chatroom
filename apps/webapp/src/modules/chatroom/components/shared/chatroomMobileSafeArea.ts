import type { CSSProperties } from 'react';

/** Horizontal + bottom safe-area padding for chatroom footers on mobile rounded-edge screens. */
export function getChatroomMobileFooterSafeAreaStyle(mobile: boolean): CSSProperties {
  if (!mobile) return {};

  const safeLeft = 'env(safe-area-inset-left, 0px)';
  const safeRight = 'env(safe-area-inset-right, 0px)';
  const safeBottom = 'env(safe-area-inset-bottom, 0px)';

  return {
    paddingLeft: `max(16px, ${safeLeft})`,
    paddingRight: `max(16px, ${safeRight})`,
    paddingBottom: safeBottom,
  };
}
