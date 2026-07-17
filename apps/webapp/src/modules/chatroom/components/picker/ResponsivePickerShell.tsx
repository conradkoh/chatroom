'use client';

import React, { useEffect, useState } from 'react';

import { getMobileDrawerContentStyle } from './getMobileDrawerContentStyle';
import {
  MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from './mobileDrawerLayout';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';
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
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);

  const isDesktop = useIsDesktop(desktopBreakpoint);
  const keyboardInsetPx = useVisualViewportKeyboardInset(isClient && !isDesktop);

  if (disabled) {
    return <>{trigger}</>;
  }

  // Avoid Drawer/Popover branch flip before useIsDesktop resolves
  if (!isClient) {
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
    <Drawer open={open} onOpenChange={onOpenChange} nested repositionInputs={false}>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent
        className={cn(MOBILE_DRAWER_CONTENT_CLASSNAME, drawerContentClassName)}
        style={getMobileDrawerContentStyle(keyboardInsetPx)}
      >
        <DrawerHeader className="p-0 shrink-0">
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
        </DrawerHeader>
        <div className={cn(MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME)}>{children}</div>
      </DrawerContent>
    </Drawer>
  );
}
