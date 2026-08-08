/**
 * Chatroom-local Dialog — industrial theme (sharp corners, chatroom palette).
 * Use for modals inside the chatroom UI instead of @/components/ui/dialog.
 *
 * ## Layout contracts (tailwind-merge aware)
 *
 * **Default (grid):** DialogContent uses industrial `grid gap-4`. Use for simple
 * dialogs with header/footer/body that fit without internal scroll. Do not pass
 * `flex flex-col` unless you need the scroll contract below.
 *
 * **Scroll (flex column):** For scrollable body content:
 * 1. Pass `flex flex-col min-h-0` (and optional max-h) on DialogContent className
 * 2. Wrap scrollable region in `<DialogScrollBody>`
 * Passing `flex flex-col` overrides industrial `grid` — this is intentional.
 *
 * ## Overflow
 * Do not pass overflow-* classes to DialogContent — use DialogScrollBody.
 * Overflow classes are stripped from DialogContent className.
 *
 * Never add position/display utilities to DialogContent's internal suffix —
 * tailwind-merge will strip industrial `fixed`/`grid` (445ae39b5 regression).
 */
'use client';

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type * as React from 'react';

import {
  chatroomIndustrialDialogDescriptionClassName,
  chatroomIndustrialDialogFooterClassName,
  chatroomIndustrialDialogTitleClassName,
  chatroomIndustrialFloatingModalContentClassName,
  chatroomIndustrialFloatingOverlayClassName,
  chatroomIndustrialModalContentClassName,
  chatroomIndustrialOverlayClassName,
} from '../shared/industrialDialogStyles';
import {
  OverlayPortalContainerProvider,
  useOverlayPortalContainer,
} from '../shared/overlayPortalContainer';
import { releaseBodyPointerLock } from '../shared/releaseBodyPointerLock';

import { useAllowTouchSelection } from '@/hooks/useAllowTouchSelection';
import { cn } from '@/lib/utils';

function Dialog({ modal = true, onOpenChange, ...props }: DialogPrimitive.Root.Props) {
  const handleOpenChange = (
    open: boolean,
    eventDetails: DialogPrimitive.Root.ChangeEventDetails
  ) => {
    if (!open) {
      requestAnimationFrame(() => releaseBodyPointerLock());
    }
    onOpenChange?.(open, eventDetails);
  };
  return (
    <DialogPrimitive.Root
      data-slot="chatroom-dialog"
      modal={modal}
      onOpenChange={handleOpenChange}
      {...props}
    />
  );
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="chatroom-dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="chatroom-dialog-portal" {...props} />;
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="chatroom-dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  floating,
  ...props
}: DialogPrimitive.Backdrop.Props & { floating?: boolean }) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="chatroom-dialog-overlay"
      className={cn(
        floating ? chatroomIndustrialFloatingOverlayClassName : chatroomIndustrialOverlayClassName,
        className
      )}
      {...props}
    />
  );
}

/** Strip overflow-* utilities — DialogContent must stay overflow-visible. */
export function stripOverflowFromClassName(className?: string): string {
  if (!className) return '';
  return className
    .split(/\s+/)
    .filter((token) => token && !/^!?overflow(-[xy])?(-\w+)?$/.test(token))
    .join(' ');
}

export function DialogScrollBody({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chatroom-dialog-scroll-body"
      className={cn('min-h-0 flex-1 overflow-y-auto overflow-x-hidden', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function DialogContent({
  className,
  children,
  floating,
  onEscapeKeyDown,
  onOpenAutoFocus,
  ...props
}: Omit<DialogPrimitive.Popup.Props, 'className' | 'onOpenAutoFocus'> & {
  className?: string;
  floating?: boolean;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: { preventDefault: () => void }) => void;
}) {
  useAllowTouchSelection();
  const portalContainer = useOverlayPortalContainer();
  const isFloating = floating ?? portalContainer != null;
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const safeClassName = stripOverflowFromClassName(className);

  // Base UI handles focus internally on real browsers, but jsdom does not run
  // its focus manager. Preserve Radix onOpenAutoFocus semantics so dialogs can
  // focus an input on open. The Popup mounts only while open, so a mount effect
  // runs with the child input refs already attached.
  useEffect(() => {
    if (onOpenAutoFocus) onOpenAutoFocus({ preventDefault: () => undefined });
  }, [onOpenAutoFocus]);

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
    <DialogPortal>
      <DialogOverlay floating={isFloating} />
      <DialogPrimitive.Popup
        data-slot="chatroom-dialog-content"
        className={cn(
          isFloating
            ? chatroomIndustrialFloatingModalContentClassName
            : chatroomIndustrialModalContentClassName,
          safeClassName,
          // Keep overflow-visible for portaled popovers. Never add position/display
          // utilities here — tailwind-merge will strip industrial fixed/grid (445ae39b5 regression).
          'overflow-visible'
        )}
        onKeyDown={handleKeyDown}
        {...props}
      >
        <div
          ref={setPortalHost}
          data-slot="chatroom-dialog-portal-host"
          className="pointer-events-none fixed inset-0 overflow-visible z-[60]"
        />
        <OverlayPortalContainerProvider container={portalHost}>
          {children}
        </OverlayPortalContainerProvider>
        <DialogPrimitive.Close className="absolute top-4 right-4 rounded-none opacity-70 transition-opacity hover:opacity-100 text-chatroom-text-muted hover:text-chatroom-text-primary focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4">
          <XIcon />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chatroom-dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chatroom-dialog-footer"
      className={cn(chatroomIndustrialDialogFooterClassName, className)}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="chatroom-dialog-title"
      className={cn(chatroomIndustrialDialogTitleClassName, className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="chatroom-dialog-description"
      className={cn(chatroomIndustrialDialogDescriptionClassName, className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
