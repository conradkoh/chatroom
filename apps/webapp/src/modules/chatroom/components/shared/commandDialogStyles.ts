/**
 * Shared styling constants for command-style dialogs (Cmd+P, Cmd+K, Cmd+Shift+P).
 *
 * These dialogs share the same visual treatment: no overlay, industrial theme,
 * instant open animation, and consistent positioning.
 */

/**
 * Classes for DialogPrimitive.Content in command-style dialogs.
 *
 * Position: 10% from top on mobile, 40% on desktop — VSCode-style.
 * Industrial theme: sharp corners, 2px adaptive border, drop shadow for depth.
 * Animation: instant open (duration-0), smooth close with fade+zoom-out (duration-200).
 */
export const COMMAND_DIALOG_CONTENT_CLASSES = [
  // Position: near top on mobile (10%), centered on desktop (40%)
  'fixed left-[50%] z-50 w-[600px] max-w-[90vw] translate-x-[-50%]',
  'top-[10%] translate-y-[-10%] sm:top-[40%] sm:translate-y-[-40%]',
  // Industrial theme: sharp corners, 2px adaptive border, drop shadow for depth
  'rounded-none border-2 border-chatroom-border shadow-lg',
  // Background
  'bg-chatroom-bg-primary overflow-hidden',
  // Animation: open instantly (duration-0), close with smooth fade+zoom-out
  'data-[state=open]:animate-in data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
  'data-[state=closed]:zoom-out-95',
  'data-[state=open]:duration-0 data-[state=closed]:duration-200',
] as const;

/**
 * Classes for cmdk group headings in command-style dialogs.
 */
export const COMMAND_GROUP_HEADING_CLASSES =
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-chatroom-text-muted';
