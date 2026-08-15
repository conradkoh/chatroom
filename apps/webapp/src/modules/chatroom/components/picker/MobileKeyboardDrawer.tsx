'use client';
import { useMemo, type ReactNode } from 'react';
import { getMobileDrawerContentStyle } from './getMobileDrawerContentStyle';
import { MOBILE_DRAWER_CONTENT_CLASSNAME } from './mobileDrawerLayout';
import { PickerShellProvider } from './PickerShellContext';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useVisualViewportKeyboardInset, useVisualViewportOffsetTop } from '@/hooks/useMobileKeyboard';
import { cn } from '@/lib/utils';
export interface MobileKeyboardDrawerProps { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; header?: ReactNode; headerClassName?: string; contentClassName?: string; drawerContentClassName?: string; nested?: boolean; repositionInputs?: boolean; handleOnly?: boolean; container?: HTMLElement; }
export function MobileKeyboardDrawer({ open, onOpenChange, title, children, header, headerClassName, contentClassName, drawerContentClassName, nested, repositionInputs = false, handleOnly = true, container }: MobileKeyboardDrawerProps) {
  const inset = useVisualViewportKeyboardInset(open); const offset = useVisualViewportOffsetTop(open);
  const value = useMemo(() => ({ mobileKeyboardOpen: open && inset > 0 }), [open, inset]);
  return <Drawer open={open} onOpenChange={onOpenChange} nested={nested} repositionInputs={repositionInputs} handleOnly={handleOnly} container={container}>
    <DrawerContent className={cn(MOBILE_DRAWER_CONTENT_CLASSNAME, drawerContentClassName)} style={getMobileDrawerContentStyle(inset, offset)}>
      <DrawerHeader className={cn('shrink-0', headerClassName)}>{header ?? <DrawerTitle className="sr-only">{title}</DrawerTitle>}</DrawerHeader>
      <PickerShellProvider value={value}><div className={cn('flex flex-col min-h-0 flex-1 overflow-y-auto', contentClassName)}>{children}</div></PickerShellProvider>
    </DrawerContent>
  </Drawer>;
}
