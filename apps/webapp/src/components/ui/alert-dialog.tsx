/**
 * Chatroom-local AlertDialog — industrial theme (sharp corners, chatroom palette).
 */
'use client';

import { AlertDialog as AlertDialogPrimitive } from '@base-ui/react/alert-dialog';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { useAllowTouchSelection } from '@/hooks/useAllowTouchSelection';
import { cn } from '@/lib/utils';
import {
  chatroomIndustrialButtonDestructiveClassName,
  chatroomIndustrialButtonSecondaryClassName,
  chatroomIndustrialConfirmationModalContentClassName,
  chatroomIndustrialConfirmationOverlayClassName,
  chatroomIndustrialDialogDescriptionClassName,
  chatroomIndustrialDialogFooterClassName,
  chatroomIndustrialDialogTitleClassName,
  chatroomIndustrialModalContentClassName,
  chatroomIndustrialOverlayClassName,
} from '@/modules/chatroom/components/shared/industrialDialogStyles';
import { useOverlayPortalContainer } from '@/modules/chatroom/components/shared/overlayPortalContainer';

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

function AlertDialogTrigger({ ...props }: AlertDialogPrimitive.Trigger.Props) {
  return <AlertDialogPrimitive.Trigger data-slot="alert-dialog-trigger" {...props} />;
}

function AlertDialogPortal({ container, ...props }: AlertDialogPrimitive.Portal.Props) {
  const parentContainer = useOverlayPortalContainer();
  return (
    <AlertDialogPrimitive.Portal
      data-slot="alert-dialog-portal"
      container={container ?? parentContainer ?? undefined}
      {...props}
    />
  );
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  const portalContainer = useOverlayPortalContainer();
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        portalContainer != null
          ? chatroomIndustrialConfirmationOverlayClassName
          : chatroomIndustrialOverlayClassName,
        className
      )}
      {...props}
    />
  );
}

function AlertDialogContent({
  className,
  size = 'default',
  ...props
}: AlertDialogPrimitive.Popup.Props & { size?: 'default' | 'sm' }) {
  useAllowTouchSelection();
  const portalContainer = useOverlayPortalContainer();

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        data-size={size}
        className={cn(
          'group/alert-dialog-content data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-lg',
          portalContainer != null
            ? chatroomIndustrialConfirmationModalContentClassName
            : chatroomIndustrialModalContentClassName,
          className
        )}
        {...props}
      />
    </AlertDialogPortal>
  );
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  );
}

function AlertDialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(chatroomIndustrialDialogFooterClassName, className)}
      {...props}
    />
  );
}

function AlertDialogMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-dialog-media"
      className={cn(
        'mb-2 inline-flex size-16 items-center justify-center rounded-none bg-chatroom-bg-tertiary *:[svg:not([class*="size-"])]:size-8',
        className
      )}
      {...props}
    />
  );
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn(chatroomIndustrialDialogTitleClassName, className)}
      {...props}
    />
  );
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn(chatroomIndustrialDialogDescriptionClassName, className)}
      {...props}
    />
  );
}

function AlertDialogAction({
  className,
  variant = 'destructive',
  size = 'default',
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-action"
      render={<Button variant={variant} size={size} />}
      className={cn(chatroomIndustrialButtonDestructiveClassName, className)}
      {...props}
    />
  );
}

function AlertDialogCancel({
  className,
  variant = 'outline',
  size = 'default',
  ...props
}: AlertDialogPrimitive.Close.Props &
  Pick<React.ComponentProps<typeof Button>, 'variant' | 'size'>) {
  return (
    <AlertDialogPrimitive.Close
      data-slot="alert-dialog-cancel"
      render={<Button variant={variant} size={size} />}
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
  AlertDialogMedia,
  AlertDialogAction,
  AlertDialogCancel,
};
