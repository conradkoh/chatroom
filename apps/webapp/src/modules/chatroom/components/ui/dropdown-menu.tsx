/**
 * Chatroom-local DropdownMenu — themed for portaled floating menus in the chatroom UI.
 * Defaults to modal={false} for performance; items use Radix focus/highlight states
 * with chatroom hover colors instead of shadcn accent grey.
 */
'use client';

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/** Shared highlight styles for chatroom dropdown items (Radix roving focus / data-highlighted). */
export const chatroomDropdownMenuItemHighlightClassName =
  'rounded-none text-chatroom-text-primary focus:bg-chatroom-bg-hover focus:text-chatroom-text-primary data-[highlighted]:bg-chatroom-bg-hover data-[highlighted]:text-chatroom-text-primary';

/** Shared surface styles for chatroom portaled dropdown panels. */
export const chatroomDropdownMenuContentClassName =
  'z-[100] pointer-events-auto bg-chatroom-bg-primary text-chatroom-text-primary border border-chatroom-border p-0 rounded-none shadow-md';

function DropdownMenu({
  modal = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  return <DropdownMenuPrimitive.Root data-slot="chatroom-dropdown-menu" modal={modal} {...props} />;
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
        'relative flex cursor-pointer items-center gap-2 px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
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

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
};
