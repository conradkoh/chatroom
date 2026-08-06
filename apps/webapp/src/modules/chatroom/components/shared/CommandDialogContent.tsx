'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useLayoutEffect, useRef } from 'react';

import {
  COMMAND_DIALOG_CONTENT_CLASSES,
  COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES,
  getCommandDialogContentStyle,
} from './commandDialogStyles';
import { useCommandDialogStore } from './useCommandDialogStore';

import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';

const COMMAND_DIALOG_INPUT_SELECTOR = '[data-slot="command-input"]';

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
};

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
  onPointerDownOutside: _onPointerDownOutside,
  onFocusOutside: _onFocusOutside,
  children,
  ...props
}: CommandDialogContentProps) {
  const isDesktop = useIsDesktop(640);
  const viewportOffsetTopPx = useVisualViewportOffsetTop(open && !isDesktop);
  const viewportStyle = getCommandDialogContentStyle(viewportOffsetTopPx);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const {
    mounted,
    open: storeOpen,
    transitionStatus,
    titleElementId,
    descriptionElementId,
    setPopupElement,
    popupRef,
  } = useCommandDialogStore();

  const setRefs = (node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    popupRef.current = node;
    setPopupElement(node);
  };

  useLayoutEffect(() => {
    if (!storeOpen) return;
    focusCommandDialogInput(surfaceRef.current);
    queueMicrotask(() => focusCommandDialogInput(surfaceRef.current));
  }, [storeOpen]);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !onEscapeKeyDown) return;
    onEscapeKeyDown(event.nativeEvent);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  const dataState = !mounted
    ? {}
    : storeOpen
      ? { 'data-open': '' as const }
      : { 'data-closed': '' as const };

  return (
    <DialogPrimitive.Portal keepMounted>
      {open ? (
        <DialogPrimitive.Close
          nativeButton={false}
          render={
            <div
              data-slot="command-dialog-dismiss-backdrop"
              aria-hidden="true"
              className={COMMAND_DIALOG_DISMISS_BACKDROP_CLASSES}
            />
          }
        />
      ) : null}
      <div
        ref={setRefs}
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleElementId ?? undefined}
        aria-describedby={descriptionElementId ?? undefined}
        data-slot="command-dialog-content"
        hidden={!mounted}
        data-transition-status={transitionStatus}
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
