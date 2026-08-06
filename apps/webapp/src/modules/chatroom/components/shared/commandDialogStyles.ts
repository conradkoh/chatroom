/**
 * Shared styling constants for command-style dialogs (Cmd+P, Cmd+K, Cmd+Shift+P).
 *
 * These dialogs share the same visual treatment: transparent dismiss backdrop,
 * industrial theme, instant open and close (no animation), and consistent positioning.
 */

import type { CSSProperties } from 'react';

import {
  chatroomIndustrialPanelBorderClassName,
  chatroomIndustrialSurfaceClassName,
} from './industrialDialogStyles';
import { Z_PANEL } from './overlayLayers';

/**
 * Transparent full-screen layer that intercepts outside pointer events.
 * Static (no animation) and invisible — distinct from a visible dimming
 * overlay. Sits below command content (z-50) at z-40.
 * MUST only render while the dialog is open — CommandDialogContent is forceMount.
 */
export const COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES =
  `${Z_PANEL} fixed inset-0 bg-transparent` as const;

/**
 * Classes for DialogPrimitive.Content in command-style dialogs.
 *
 * Position: fixed 15% from top — top-anchored so the dialog doesn't shift
 * when content height changes (e.g. search result count changes).
 * Industrial theme: sharp corners, 2px adaptive border, drop shadow for depth.
 * Animation: none — instant open and close.
 */
export const COMMAND_DIALOG_CONTENT_CLASSES = [
  'fixed left-[50%] z-50 w-[600px] max-w-[90vw] translate-x-[-50%]',
  'top-[10%] sm:top-[15%]',
  'rounded-none shadow-lg',
  chatroomIndustrialPanelBorderClassName,
  chatroomIndustrialSurfaceClassName,
  'overflow-hidden',
  'overscroll-contain',
] as const;

/**
 * Classes for cmdk group headings in command-style dialogs.
 */
export const COMMAND_GROUP_HEADING_CLASSES =
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-chatroom-text-muted';

/**
 * Inline style override when the mobile software keyboard scrolls the layout
 * viewport (`visualViewport.offsetTop > 0`). Fixed elements stay at page-top
 * (off-screen), so the dialog must shift down by the scroll offset to anchor to
 * the visible viewport top. An inline `top` overrides the Tailwind `top-[10%]`
 * class from COMMAND_DIALOG_CONTENT_CLASSES.
 */
export function getCommandDialogContentStyle(viewportOffsetTopPx: number): CSSProperties {
  if (viewportOffsetTopPx <= 0) return {};
  const safeTop = 'env(safe-area-inset-top, 0px)';
  return {
    top: `calc(${viewportOffsetTopPx}px + ${safeTop} + 16px)`,
  };
}
