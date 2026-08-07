import type { CSSProperties } from 'react';

/**
 * Horizontal safe-area padding for mid-stack chatroom footers on mobile
 * rounded-edge screens (e.g. MessageInput sitting above the bottom bar).
 * These footers must NOT own the bottom inset — only the bottommost element
 * (`WorkspaceBottomBarShell`) should apply `paddingBottom`.
 */
export function getChatroomMobileFooterHorizontalSafeAreaStyle(mobile: boolean): CSSProperties {
  if (!mobile) return {};

  const safeLeft = 'env(safe-area-inset-left, 0px)';
  const safeRight = 'env(safe-area-inset-right, 0px)';

  return {
    paddingLeft: `max(16px, ${safeLeft})`,
    paddingRight: `max(16px, ${safeRight})`,
  };
}

/** Horizontal + bottom safe-area padding for the bottommost chatroom footer. */
export function getChatroomMobileFooterSafeAreaStyle(mobile: boolean): CSSProperties {
  if (!mobile) return {};

  return {
    ...getChatroomMobileFooterHorizontalSafeAreaStyle(mobile),
    paddingBottom: 'env(safe-area-inset-bottom, 0px)',
  };
}
