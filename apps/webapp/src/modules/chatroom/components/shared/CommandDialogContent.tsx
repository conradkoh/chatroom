'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useEffect, useRef } from 'react';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

const COMMAND_DIALOG_INPUT_SELECTOR = '[data-slot="command-input"]';

function focusCommandDialogInput(container: HTMLElement | null): void {
  const input = container?.querySelector<HTMLInputElement>(COMMAND_DIALOG_INPUT_SELECTOR);
  input?.focus({ preventScroll: true });
}

type CommandDialogContentProps = React.ComponentProps<typeof DialogPrimitive.Popup> & {
  /** Gate viewport tracking and dismiss backdrop — pass dialog open state */
  open: boolean;
};

/**
 * Shared Dialog.Popup for command-style dialogs (Cmd+K, Cmd+P, Cmd+Shift+P).
 * Applies COMMAND_DIALOG_CONTENT_CLASSES and, on mobile when the software
 * keyboard scrolls the layout viewport, anchors the dialog to the visible
 * viewport top via an inline `top` override.
 *
 * Renders a transparent dismiss backdrop (gated on `open`) below the content
 * to intercept outside pointer events without a visible/dimming overlay.
 *
 * Uses `keepMounted` on the Portal (Base UI equivalent of Radix forceMount) so
 * the popup stays mounted for the exit animation driven by
 * `data-closed:fill-mode-forwards` / `data-closed:pointer-events-none`.
 */
export function CommandDialogContent({
  open,
  className,
  style,
  onEscapeKeyDown,
  onPointerDownOutside: _onPointerDownOutside,
  onFocusOutside: _onFocusOutside,
  ...props
}: CommandDialogContentProps & {
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: Event) => void;
  onFocusOutside?: (event: Event) => void;
}) {
  const isDesktop = useIsDesktop(640); // matches sm: breakpoint in COMMAND_DIALOG_CONTENT_CLASSES
  const viewportOffsetTopPx = useVisualViewportOffsetTop(open && !isDesktop);
  const viewportStyle = getCommandDialogContentStyle(viewportOffsetTopPx);
  const popupRef = useRef<HTMLDivElement>(null);

  // Base UI non-modal dialogs do not auto-focus the first field (unlike Radix).
  // Defer until after Base UI's focus manager runs so the input keeps focus.
  useEffect(() => {
    if (!open) return;
    const timeoutId = window.setTimeout(() => {
      focusCommandDialogInput(popupRef.current);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [open]);

  // Intercept Escape so consumers can clear search / defer close before Base
  // UI's document-level handler runs. preventDefault() signals "keep open".
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !onEscapeKeyDown) return;
    onEscapeKeyDown(event.nativeEvent);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  return (
    <DialogPrimitive.Portal keepMounted>
      {open ? (
        <div
          data-slot="command-dialog-dismiss-backdrop"
          aria-hidden="true"
          className={COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES}
        />
      ) : null}
      <DialogPrimitive.Popup
        ref={popupRef}
        data-slot="command-dialog-content"
        className={cn(...COMMAND_DIALOG_CONTENT_CLASSES, className)}
        style={{ ...viewportStyle, ...style }}
        onKeyDown={handleKeyDown}
        {...props}
      />
    </DialogPrimitive.Portal>
  );
}
