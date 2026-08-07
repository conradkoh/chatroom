/**
 * Chatroom-local Popover — themed for portaled floating menus in the chatroom UI.
 * Uses opaque bg-chatroom-bg-primary for portaled PopoverContent (not glassmorphism).
 * All corners rounded-none per chatroom design spec.
 */
'use client';

import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { useCallback, useRef } from 'react';
import type * as React from 'react';

import { useOverlayDismissStack } from '../../hooks/useOverlayDismissStack';
import { chatroomPortaledMenuFloatingClassName } from '../shared/industrialDialogStyles';
import { useOverlayPortalContainer } from '../shared/overlayPortalContainer';

import { cn } from '@/lib/utils';

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
      data-slot="chatroom-popover"
      modal={modal}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

function PopoverTrigger({ ...props }: PopoverPrimitive.Trigger.Props) {
  return <PopoverPrimitive.Trigger data-slot="chatroom-popover-trigger" {...props} />;
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
          data-slot="chatroom-popover-content"
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

export { Popover, PopoverTrigger, PopoverContent };
