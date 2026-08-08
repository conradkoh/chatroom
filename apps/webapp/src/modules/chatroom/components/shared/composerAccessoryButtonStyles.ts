/**
 * Accessory controls in the chat composer toolbar (rows above MessageInput textarea).
 * Surface bg matches composer chrome (`bg-chatroom-bg-surface`), not the input field.
 */

/** Row wrapper for accessory buttons above the composer input row. */
export const composerAccessoryRowClassName = 'px-2 pt-1';

/** Bordered squarish button for composer accessory actions (icon + label). */
export const composerAccessoryButtonClassName =
  'flex items-center gap-1.5 text-xs text-chatroom-text-muted hover:text-chatroom-text-primary border-2 border-chatroom-border bg-chatroom-bg-surface hover:bg-chatroom-bg-hover hover:border-chatroom-border-strong px-2 py-1.5 transition-colors rounded-none';
