'use client';

import React from 'react';

import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { cn } from '@/lib/utils';

export interface ResponsivePickerShellProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactNode;
  title: string;
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  side?: 'top' | 'right' | 'bottom' | 'left';
  contentClassName?: string;
  drawerContentClassName?: string;
  desktopBreakpoint?: number;
  disabled?: boolean;
}

export function ResponsivePickerShell({
  open,
  onOpenChange,
  trigger,
  title,
  children,
  align = 'start',
  side,
  contentClassName,
  drawerContentClassName,
  desktopBreakpoint,
  disabled,
}: ResponsivePickerShellProps) {
  const isDesktop = useIsDesktop(desktopBreakpoint);

  if (disabled) {
    return <>{trigger}</>;
  }

  if (isDesktop) {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent
          className={cn('p-0', contentClassName)}
          align={align}
          {...(side ? { side } : {})}
        >
          {children}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        className={cn(
          'bg-chatroom-bg-primary border-t border-chatroom-border p-0 max-h-[80vh] rounded-t-none',
          drawerContentClassName
        )}
      >
        <DrawerHeader className="p-0">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
        </DrawerHeader>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
