'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

type CommandDialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Gate viewport tracking and dismiss backdrop — pass dialog open state */
  open: boolean;
};

/**
 * Shared DialogPrimitive.Content for command-style dialogs (Cmd+K, Cmd+P,
 * Cmd+Shift+P). Applies COMMAND_DIALOG_CONTENT_CLASSES and, on mobile when the
 * software keyboard scrolls the layout viewport, anchors the dialog to the
 * visible viewport top via an inline `top` override.
 *
 * Renders a transparent dismiss backdrop (gated on `open`) below the content
 * to intercept outside pointer events without a visible/dimming overlay.
 */
export function CommandDialogContent({
  open,
  className,
  style,
  ...props
}: CommandDialogContentProps) {
  const isDesktop = useIsDesktop(640); // matches sm: breakpoint in COMMAND_DIALOG_CONTENT_CLASSES
  const viewportOffsetTopPx = useVisualViewportOffsetTop(open && !isDesktop);
  const viewportStyle = getCommandDialogContentStyle(viewportOffsetTopPx);

  return (
    <>
      {open ? (
        <div
          data-slot="command-dialog-dismiss-backdrop"
          aria-hidden="true"
          className={COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES}
        />
      ) : null}
      <DialogPrimitive.Content
        forceMount
        className={cn(...COMMAND_DIALOG_CONTENT_CLASSES, className)}
        style={{ ...viewportStyle, ...style }}
        {...props}
      />
    </>
  );
}
