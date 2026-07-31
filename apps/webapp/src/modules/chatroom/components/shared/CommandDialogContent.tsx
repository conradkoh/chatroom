'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

type CommandDialogContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  /** Gate viewport tracking — pass dialog open state */
  open: boolean;
};

/**
 * Shared DialogPrimitive.Content for command-style dialogs (Cmd+K, Cmd+P,
 * Cmd+Shift+P). Applies COMMAND_DIALOG_CONTENT_CLASSES and, on mobile when the
 * software keyboard scrolls the layout viewport, anchors the dialog to the
 * visible viewport top via an inline `top` override.
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
    <DialogPrimitive.Content
      forceMount
      className={cn(...COMMAND_DIALOG_CONTENT_CLASSES, className)}
      style={{ ...viewportStyle, ...style }}
      {...props}
    />
  );
}
