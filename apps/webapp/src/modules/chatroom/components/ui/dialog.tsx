/**
 * Chatroom-local Dialog — industrial theme (sharp corners, chatroom palette).
 * Use for modals inside the chatroom UI instead of @/components/ui/dialog.
 */
'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type * as React from 'react';

import {
  chatroomIndustrialDialogDescriptionClassName,
  chatroomIndustrialDialogFooterClassName,
  chatroomIndustrialDialogTitleClassName,
  chatroomIndustrialModalContentClassName,
  chatroomIndustrialOverlayClassName,
} from '../shared/industrialDialogStyles';

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
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="chatroom-dialog-overlay"
      className={cn(chatroomIndustrialOverlayClassName, className)}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content>) {
  useAllowTouchSelection();

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="chatroom-dialog-content"
        className={cn(chatroomIndustrialModalContentClassName, className)}
        onEscapeKeyDown={onEscapeKeyDown}
        {...props}
      >
        {children}
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
