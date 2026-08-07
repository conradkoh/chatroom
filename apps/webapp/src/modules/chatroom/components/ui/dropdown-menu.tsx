/**
 * Chatroom-local DropdownMenu — themed for portaled floating menus in the chatroom UI.
 * Defaults to modal={false} for performance; items use Base UI focus/highlight
 * states with chatroom hover colors instead of shadcn accent grey.
 */
'use client';

import { Menu as DropdownMenuPrimitive } from '@base-ui/react/menu';
import { CheckIcon, ChevronRightIcon } from 'lucide-react';
import { useCallback, useRef } from 'react';
import type * as React from 'react';

import { useOverlayDismissStack } from '../../hooks/useOverlayDismissStack';
import { chatroomPortaledMenuFloatingClassName } from '../shared/industrialDialogStyles';
import { useOverlayPortalContainer } from '../shared/overlayPortalContainer';

import { cn } from '@/lib/utils';

/** Shared highlight styles for chatroom dropdown items (Base UI focus / data-highlighted). */
export const chatroomDropdownMenuItemHighlightClassName =
  'rounded-none text-chatroom-text-primary focus:bg-chatroom-bg-hover focus:text-chatroom-text-primary data-highlighted:bg-chatroom-bg-hover data-highlighted:text-chatroom-text-primary';

/** Shared surface styles for chatroom portaled dropdown panels. */
export const chatroomDropdownMenuContentClassName = `p-0 ${chatroomPortaledMenuFloatingClassName}`;

function DropdownMenu({
  modal = false,
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: Omit<DropdownMenuPrimitive.Root.Props, 'onOpenChange'> & {
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

function DropdownMenuTrigger({ ...props }: DropdownMenuPrimitive.Trigger.Props) {
  return <DropdownMenuPrimitive.Trigger data-slot="chatroom-dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  align = 'center',
  sideOffset = 4,
  alignOffset = 0,
  side = 'bottom',
  ...props
}: DropdownMenuPrimitive.Popup.Props &
  Pick<DropdownMenuPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  const portalContainer = useOverlayPortalContainer();
  return (
    <DropdownMenuPrimitive.Portal container={portalContainer ?? undefined}>
      <DropdownMenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="isolate z-50"
      >
        <DropdownMenuPrimitive.Popup
          data-slot="chatroom-dropdown-menu-content"
          className={cn(
            'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto',
            chatroomDropdownMenuContentClassName,
            className
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Positioner>
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  onSelect,
  onClick,
  ...props
}: Omit<DropdownMenuPrimitive.Item.Props, 'onClick'> & {
  onSelect?: (event: { preventDefault: () => void }) => void;
  onClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
}) {
  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    onClick?.(event);
    if (!event.defaultPrevented) {
      onSelect?.(event);
    }
  };
  return (
    <DropdownMenuPrimitive.Item
      data-slot="chatroom-dropdown-menu-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      onClick={handleClick}
      {...props}
    />
  );
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: DropdownMenuPrimitive.CheckboxItem.Props) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="chatroom-dropdown-menu-checkbox-item"
      className={cn(
        'relative flex cursor-pointer items-center gap-2 py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </DropdownMenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean;
}) {
  return (
    <div
      data-slot="chatroom-dropdown-menu-label"
      data-inset={inset}
      className={cn(
        'px-2.5 pt-1.5 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted select-none',
        inset && 'pl-8',
        className
      )}
      {...props}
    />
  );
}

function DropdownMenuSeparator({ className, ...props }: DropdownMenuPrimitive.Separator.Props) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="chatroom-dropdown-menu-separator"
      className={cn('bg-chatroom-border -mx-0 my-0.5 h-px', className)}
      {...props}
    />
  );
}

function DropdownMenuSub({ ...props }: DropdownMenuPrimitive.SubmenuRoot.Props) {
  return <DropdownMenuPrimitive.SubmenuRoot data-slot="chatroom-dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: DropdownMenuPrimitive.SubmenuTrigger.Props) {
  return (
    <DropdownMenuPrimitive.SubmenuTrigger
      data-slot="chatroom-dropdown-menu-sub-trigger"
      className={cn(
        'flex cursor-pointer items-center gap-1.5 px-2.5 py-1.5 text-sm outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50',
        chatroomDropdownMenuItemHighlightClassName,
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </DropdownMenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: DropdownMenuPrimitive.Popup.Props) {
  return (
    <DropdownMenuPrimitive.Positioner className="isolate z-50">
      <DropdownMenuPrimitive.Popup
        data-slot="chatroom-dropdown-menu-sub-content"
        className={cn(
          'data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 max-h-(--available-height) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto',
          chatroomDropdownMenuContentClassName,
          className
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Positioner>
  );
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
};
