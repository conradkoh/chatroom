/**
 * Chatroom-local DropdownMenu — themed for portaled floating menus in the chatroom UI.
 * Defaults to modal={false} for performance; items use Radix focus/highlight states
 * with chatroom hover colors instead of shadcn accent grey.
 */
'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type * as React from 'react';

import { useOverlayDismissStack } from '../../hooks/useOverlayDismissStack';
import { chatroomPortaledMenuFloatingClassName } from '../shared/industrialDialogStyles';

import { cn } from '@/lib/utils';

/** Shared highlight styles for chatroom dropdown items (Radix roving focus / data-highlighted). */
export const chatroomDropdownMenuItemHighlightClassName =
  'rounded-none text-chatroom-text-primary focus:bg-chatroom-bg-hover focus:text-chatroom-text-primary data-[highlighted]:bg-chatroom-bg-hover data-[highlighted]:text-chatroom-text-primary';

/** Shared surface styles for chatroom portaled dropdown panels. */
export const chatroomDropdownMenuContentClassName = `p-0 ${chatroomPortaledMenuFloatingClassName}`;

function DropdownMenu({
  modal = false,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const dismissRef = useRef<() => void>(() => undefined);

  dismissRef.current = () => {
    onOpenChange?.(false);
  };

  const dismiss = useCallback(() => {
    dismissRef.current();
  }, []);

  useOverlayDismissStack(open === true, dismiss);

  return (
    <DropdownMenuPrimitive.Root
      data-slot="chatroom-dropdown-menu"
      modal={modal}
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      {...props}
    />
  );
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="chatroom-dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="chatroom-dropdown-menu-content"
        sideOffset={sideOffset}
        className={cn(
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto',
          chatroomDropdownMenuContentClassName,
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="chatroom-dropdown-menu-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="chatroom-dropdown-menu-checkbox-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-2 py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="chatroom-dropdown-menu-separator"
      className={cn('bg-chatroom-border -mx-0 my-0.5 h-px', className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
  return <DropdownMenuPrimitive.Sub data-slot="chatroom-dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      data-slot="chatroom-dropdown-menu-sub-trigger"
      className={cn(
        'flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      data-slot="chatroom-dropdown-menu-sub-content"
      className={cn(
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-(--radix-dropdown-menu-content-available-height) min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto',
        chatroomDropdownMenuContentClassName,
        className
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
