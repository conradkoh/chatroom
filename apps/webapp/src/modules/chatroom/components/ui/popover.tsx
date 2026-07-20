/**
 * Chatroom-local Popover — themed for portaled floating menus in the chatroom UI.
 * Uses opaque bg-chatroom-bg-primary for portaled PopoverContent (not glassmorphism).
 * All corners rounded-none per chatroom design spec.
 */
'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
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
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
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

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="chatroom-popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="chatroom-popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  const portalContainer = useOverlayPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="chatroom-popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 w-72 origin-(--radix-popover-content-transform-origin)',
          chatroomPortaledMenuFloatingClassName,
          className
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor };
