/**
 * Chatroom-local Dialog — industrial theme (sharp corners, chatroom palette).
 * Use for modals inside the chatroom UI instead of @/components/ui/dialog.
 *
 * Do not pass overflow-* classes to DialogContent — use DialogScrollBody for
 * scrollable body. Overflow classes are stripped from DialogContent className.
 */
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import { useState } from 'react';
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
import { OverlayPortalContainerProvider } from '../shared/overlayPortalContainer';

import { useAllowTouchSelection } from '@/hooks/useAllowTouchSelection';
import { cn } from '@/lib/utils';

function Dialog({ modal = true, ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="chatroom-dialog" modal={modal} {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="chatroom-dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="chatroom-dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="chatroom-dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  floating,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay> & { floating?: boolean }) {
  return (
    <DialogPrimitive.Overlay
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
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { floating?: boolean }) {
  useAllowTouchSelection();
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const safeClassName = stripOverflowFromClassName(className);

  return (
    <DialogPortal>
      <DialogOverlay floating={floating} />
      <DialogPrimitive.Content
        data-slot="chatroom-dialog-content"
        className={cn(
          floating
            ? chatroomIndustrialFloatingModalContentClassName
            : chatroomIndustrialModalContentClassName,
          safeClassName,
          'overflow-visible relative flex flex-col'
        )}
        onEscapeKeyDown={onEscapeKeyDown}
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
      </DialogPrimitive.Content>
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

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="chatroom-dialog-title"
      className={cn(chatroomIndustrialDialogTitleClassName, className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
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
