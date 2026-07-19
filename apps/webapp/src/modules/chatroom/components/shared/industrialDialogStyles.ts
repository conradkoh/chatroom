/**
 * Canonical industrial surface tokens for chatroom modals, alerts, and inputs.
 * See docs/application/design/theme.md — sharp corners, 2px borders, chatroom palette.
 */

const chatroomIndustrialBorderClassName = 'border-2 border-chatroom-border-strong';

export const chatroomIndustrialPanelBorderClassName = 'border-2 border-chatroom-border';

export const chatroomIndustrialSurfaceClassName =
  'bg-chatroom-bg-primary text-chatroom-text-primary';

const chatroomIndustrialOverlayAnimationClassName =
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0';

const chatroomIndustrialModalContentAnimationClassName = [
  'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
  'fixed top-[50%] left-[50%] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 p-6 shadow-lg duration-200 sm:max-w-lg',
] as const;

/** Base overlay for standalone chatroom dialogs (page-level). */
export const chatroomIndustrialOverlayClassName = `${chatroomIndustrialOverlayAnimationClassName} z-50 bg-black/60`;

export const chatroomIndustrialModalContentClassName = [
  ...chatroomIndustrialModalContentAnimationClassName,
  'z-50',
  'rounded-none',
  chatroomIndustrialBorderClassName,
  chatroomIndustrialSurfaceClassName,
] as const;

export const chatroomIndustrialDialogTitleClassName =
  'text-lg font-bold uppercase tracking-wider text-chatroom-text-primary';

export const chatroomIndustrialDialogDescriptionClassName = 'text-sm text-chatroom-text-secondary';

export const chatroomIndustrialDialogFooterClassName =
  'flex flex-col-reverse gap-2 border-t border-chatroom-border pt-4 sm:flex-row sm:justify-end';

export const chatroomIndustrialButtonPrimaryClassName =
  'inline-flex h-9 items-center justify-center px-4 text-sm font-bold rounded-none bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-accent/90 border-0 transition-opacity';

export const chatroomIndustrialButtonSecondaryClassName =
  'inline-flex h-9 items-center justify-center px-4 text-sm font-bold rounded-none bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-secondary hover:bg-chatroom-bg-hover hover:text-chatroom-text-primary transition-opacity';

export const chatroomIndustrialButtonDestructiveClassName =
  'inline-flex h-9 items-center justify-center px-4 text-sm font-bold rounded-none bg-chatroom-status-error text-white hover:bg-chatroom-status-error/90 border-0 transition-opacity';

export const chatroomIndustrialInputClassName =
  'bg-chatroom-bg-secondary border border-chatroom-border text-chatroom-text-primary placeholder:text-chatroom-text-muted rounded-none outline-none focus-visible:ring-0 focus-visible:border-chatroom-border-strong';

export const chatroomIndustrialInputErrorClassName = 'border-chatroom-status-error';

/** Opaque surface for Radix-portaled menus (dropdown, select, popover). Never use bg-chatroom-bg-surface here. */
export const chatroomPortaledMenuSurfaceClassName =
  'bg-chatroom-bg-primary text-chatroom-text-primary border border-chatroom-border rounded-none shadow-md';

/**
 * Base classes for portaled menu panels — z-50 band (stacking via portal DOM order).
 */
// fallow-ignore-next-line unused-export
export const chatroomPortaledMenuFloatingClassName = `z-50 pointer-events-auto outline-none ${chatroomPortaledMenuSurfaceClassName}`;
