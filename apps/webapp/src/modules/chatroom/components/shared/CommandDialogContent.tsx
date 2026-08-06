'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

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
};

// fallow-ignore-next-line complexity
function readCommandDialogAriaIds(node: HTMLDivElement) {
  return {
    titleElementId: node.querySelector(COMMAND_DIALOG_TITLE_SELECTOR)?.id || undefined,
    descriptionElementId: node.querySelector(COMMAND_DIALOG_DESCRIPTION_SELECTOR)?.id || undefined,
  };
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
  onPointerDownOutside: _onPointerDownOutside,
  onFocusOutside: _onFocusOutside,
  children,
  ...props
}: CommandDialogContentProps) {
  const isDesktop = useIsDesktop(640);
  const viewportOffsetTopPx = useVisualViewportOffsetTop(open && !isDesktop);
  const viewportStyle = getCommandDialogContentStyle(viewportOffsetTopPx);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const [mounted, setMounted] = useState(open);
  const [titleElementId, setTitleElementId] = useState<string | undefined>();
  const [descriptionElementId, setDescriptionElementId] = useState<string | undefined>();
  const [surfaceAttached, setSurfaceAttached] = useState(false);

  const assignSurfaceRef = useCallback((node: HTMLDivElement | null) => {
    surfaceRef.current = node;
    setSurfaceAttached(!!node);
  }, []);

  useLayoutEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    focusCommandDialogInput(surfaceRef.current);
  }, [open, surfaceAttached]);

  useLayoutEffect(() => {
    const node = surfaceRef.current;
    if (!node || !open) {
      setTitleElementId(undefined);
      setDescriptionElementId(undefined);
      return;
    }
    const ids = readCommandDialogAriaIds(node);
    setTitleElementId(ids.titleElementId);
    setDescriptionElementId(ids.descriptionElementId);
  }, [open, children, surfaceAttached]);

  const handleTransitionEnd = useCallback(
    (event: React.TransitionEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (!open) setMounted(false);
    },
    [open]
  );

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== 'Escape' || !onEscapeKeyDown) return;
    onEscapeKeyDown(event.nativeEvent);
    if (event.defaultPrevented) {
      event.stopPropagation();
    }
  };

  const isSurfaceVisible = open || mounted;
  const dataState = !isSurfaceVisible
    ? {}
    : open
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
        ref={assignSurfaceRef}
        role="dialog"
        aria-modal={false}
        aria-labelledby={titleElementId ?? undefined}
        aria-describedby={descriptionElementId ?? undefined}
        data-slot="command-dialog-content"
        hidden={!isSurfaceVisible}
        className={cn(...COMMAND_DIALOG_CONTENT_CLASSES, className)}
        style={{ ...viewportStyle, ...style }}
        onKeyDown={handleKeyDown}
        onTransitionEnd={handleTransitionEnd}
        tabIndex={-1}
        {...dataState}
        {...props}
      >
        {children}
      </div>
    </DialogPrimitive.Portal>
  );
}
