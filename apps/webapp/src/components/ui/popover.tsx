/**
 * Chatroom-local Popover — themed for portaled floating menus in the chatroom UI.
 * Uses opaque bg-chatroom-bg-primary for portaled PopoverContent (not glassmorphism).
 * All corners rounded-none per chatroom design spec.
 */
'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { useCallback, useRef } from 'react';
import type * as React from 'react';

import { cn } from '@/lib/utils';
import { chatroomPortaledMenuFloatingClassName } from '@/modules/chatroom/components/shared/industrialDialogStyles';
import { useOverlayPortalContainer } from '@/modules/chatroom/components/shared/overlayPortalContainer';
import { useOverlayDismissStack } from '@/modules/chatroom/hooks/useOverlayDismissStack';

function Popover({
  modal = false,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<PopoverPrimitive.Root.Props, 'onOpenChange'> & {
  onOpenChange?: (open: boolean) => void;
}) {
  const dismissRef = useRef<() => void>(() => undefined);

  dismissRef.current = () => {
    onOpenChange?.(false);
  };

  const dismiss = useCallback(() => {
    dismissRef.current();
  }, []);

  useOverlayDismissStack(open === true, dismiss);

  return (
    <PopoverPrimitive.Root
      data-slot="popover"
      modal={modal}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  alignOffset = 0,
  side = 'bottom',
  sideOffset = 4,
  anchor,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<
    PopoverPrimitive.Positioner.Props,
    'align' | 'alignOffset' | 'side' | 'sideOffset' | 'anchor'
  >) {
  const portalContainer = useOverlayPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
      <PopoverPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        anchor={anchor}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-72 origin-(--transform-origin)',
            chatroomPortaledMenuFloatingClassName,
            className
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

function PopoverHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="popover-header"
      className={cn('flex flex-col gap-1 text-sm', className)}
      {...props}
    />
  );
}

function PopoverTitle({ className, ...props }: PopoverPrimitive.Title.Props) {
  return (
    <PopoverPrimitive.Title
      data-slot="popover-title"
      className={cn('font-bold text-chatroom-text-primary', className)}
      {...props}
    />
  );
}

function PopoverDescription({ className, ...props }: PopoverPrimitive.Description.Props) {
  return (
    <PopoverPrimitive.Description
      data-slot="popover-description"
      className={cn('text-chatroom-text-secondary', className)}
      {...props}
    />
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverHeader, PopoverTitle, PopoverDescription };
