'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

const COMMAND_DIALOG_INPUT_SELECTOR = '[data-slot="command-input"]';
const COMMAND_DIALOG_TITLE_SELECTOR = '[data-slot="dialog-title"]';
const COMMAND_DIALOG_DESCRIPTION_SELECTOR = '[data-slot="dialog-description"]';

function focusCommandDialogInput(container: HTMLElement | null): void {
  const input = container?.querySelector<HTMLInputElement>(COMMAND_DIALOG_INPUT_SELECTOR);
  input?.focus({ preventScroll: true });
}

type CommandDialogContentProps = Omit<
  React.ComponentProps<'div'>,
  'role' | 'hidden' | 'children'
> & {
  open: boolean;
  children?: React.ReactNode;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onPointerDownOutside?: (event: Event) => void;
  onFocusOutside?: (event: Event) => void;
  onBackdropDismiss?: () => void;
};

// fallow-ignore-next-line complexity
function readCommandDialogAriaIds(node: HTMLDivElement) {
  return {
    titleElementId: node.querySelector(COMMAND_DIALOG_TITLE_SELECTOR)?.id || undefined,
    descriptionElementId: node.querySelector(COMMAND_DIALOG_DESCRIPTION_SELECTOR)?.id || undefined,
  };
}

// fallow-ignore-next-line complexity
function handleBackdropPointerDown(
  event: React.PointerEvent<HTMLDivElement>,
  onPointerDownOutside: CommandDialogContentProps['onPointerDownOutside'],
  onBackdropDismiss: CommandDialogContentProps['onBackdropDismiss']
): void {
  if (event.button !== 0) return;
  event.preventDefault();
  onPointerDownOutside?.(event.nativeEvent);
  if (!event.nativeEvent.defaultPrevented) {
    onBackdropDismiss?.();
  }
}

/**
 * Lightweight portal surface for command-style dialogs (Cmd+K, Cmd+P, Cmd+Shift+P).
 * Bypasses Base UI Dialog.Popup / FloatingFocusManager to avoid full-document DOM
 * walks on every open (regression after Base UI migration).
 */
// fallow-ignore-next-line complexity
export function CommandDialogContent({
  open,
  className,
  style,
  onEscapeKeyDown,
  onPointerDownOutside,
  onFocusOutside: _onFocusOutside,
  onBackdropDismiss,
  children,
  ...props
}: CommandDialogContentProps) {
  const isDesktop = useIsDesktop(640);
  const viewportOffsetTopPx = useVisualViewportOffsetTop(open && !isDesktop);
  const viewportStyle = getCommandDialogContentStyle(viewportOffsetTopPx);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [attachGeneration, bumpAttachGeneration] = useReducer((n: number) => n + 1, 0);

  const [mounted, setMounted] = useState(open);
  const isSurfaceVisible = open || mounted;

  const assignSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    if (node) bumpAttachGeneration();
  }, []);

  const ariaIds =
    open && surfaceRef.current
      ? readCommandDialogAriaIds(surfaceRef.current)
      : { titleElementId: undefined, descriptionElementId: undefined };

  useLayoutEffect(() => {
    if (open) {
      setMounted(true);
    } else {
      setMounted(false);
    }
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    focusCommandDialogInput(surfaceRef.current);
  }, [open, attachGeneration]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !onEscapeKeyDown) return;
    onEscapeKeyDown(event.nativeEvent);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  const dataState = open ? { 'data-open': '' as const } : {};

  return (
    <DialogPrimitive.Portal keepMounted>
      {open ? (
        <div
          data-slot="command-dialog-dismiss-backdrop"
          aria-hidden="true"
          className={COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES}
          onPointerDown={(event) =>
            handleBackdropPointerDown(event, onPointerDownOutside, onBackdropDismiss)
          }
        />
      ) : null}
      <div
        ref={assignSurfaceRef}
        role="dialog"
        aria-modal={false}
        aria-labelledby={ariaIds.titleElementId ?? undefined}
        aria-describedby={ariaIds.descriptionElementId ?? undefined}
        data-slot="command-dialog-content"
        hidden={!isSurfaceVisible}
        className={cn(...COMMAND_DIALOG_CONTENT_CLASSES, className)}
        style={{ ...viewportStyle, ...style }}
        onKeyDown={handleKeyDown}
        tabIndex={-1}
        {...dataState}
        {...props}
      >
        {children}
      </div>
    </DialogPrimitive.Portal>
  );
}
