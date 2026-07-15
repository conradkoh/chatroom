/**
 * Chatroom-local AlertDialog — industrial theme (sharp corners, chatroom palette).
 */
'use client';

import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import type * as React from 'react';

import {
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialButtonSecondaryClassName,
  chatroomIndustrialDialogDescriptionClassName,
  chatroomIndustrialDialogFooterClassName,
  chatroomIndustrialDialogTitleClassName,
  chatroomIndustrialFloatingModalContentClassName,
  chatroomIndustrialFloatingOverlayClassName,
} from '../shared/industrialDialogStyles';

import { useAllowTouchSelection } from '@/hooks/useAllowTouchSelection';
import { cn } from '@/lib/utils';

function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  return <AlertDialogPrimitive.Root data-slot="chatroom-alert-dialog" {...props} />;
}

function AlertDialogTrigger({
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Trigger>) {
  return <AlertDialogPrimitive.Trigger data-slot="chatroom-alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ ...props }: React.ComponentProps<typeof AlertDialogPrimitive.Portal>) {
  return <AlertDialogPrimitive.Portal data-slot="chatroom-alert-dialog-portal" {...props} />;
}

function AlertDialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Overlay>) {
  return (
    <AlertDialogPrimitive.Overlay
      data-slot="chatroom-alert-dialog-overlay"
      className={cn(chatroomIndustrialFloatingOverlayClassName, className)}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Content>) {
  useAllowTouchSelection();

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        data-slot="chatroom-alert-dialog-content"
        className={cn(chatroomIndustrialFloatingModalContentClassName, className)}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chatroom-alert-dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="chatroom-alert-dialog-footer"
      className={cn(chatroomIndustrialDialogFooterClassName, className)}
      {...props}
    />
  );
}

function AlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="chatroom-alert-dialog-title"
      className={cn(chatroomIndustrialDialogTitleClassName, className)}
      {...props}
    />
  );
}

function AlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="chatroom-alert-dialog-description"
      className={cn(chatroomIndustrialDialogDescriptionClassName, className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Action>) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(chatroomIndustrialButtonDestructiveClassName, className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(chatroomIndustrialButtonSecondaryClassName, className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
