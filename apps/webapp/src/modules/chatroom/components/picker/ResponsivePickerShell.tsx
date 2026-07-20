'use client';

import React, { useCallback, useEffect, useState } from 'react';

import { getMobileDrawerContentStyle } from './getMobileDrawerContentStyle';
import {
  MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME,
  MOBILE_DRAWER_CONTENT_CLASSNAME,
} from './mobileDrawerLayout';
import { useOverlayPortalContainer } from '../shared/overlayPortalContainer';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/popover';

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
  /** When true and desktop, anchors the popover to the pointer-down position rather than the trigger edge. */
  anchorToPointer?: boolean;
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
  anchorToPointer,
}: ResponsivePickerShellProps) {
  const [isClient, setIsClient] = useState(false);
  useEffect(() => setIsClient(true), []);

  const isDesktop = useIsDesktop(desktopBreakpoint);
  const keyboardInsetPx = useVisualViewportKeyboardInset(isClient && !isDesktop);
  const portalContainer = useOverlayPortalContainer();
  const [pointerAnchor, setPointerAnchor] = useState<{ x: number; y: number } | null>(null);
  const [triggerEl, setTriggerEl] = useState<HTMLElement | null>(null);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setPointerAnchor(null);
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  if (disabled) {
    return <>{trigger}</>;
  }

  // Avoid Drawer/Popover branch flip before useIsDesktop resolves
  if (!isClient) {
    return <>{trigger}</>;
  }

  // ── Desktop + anchorToPointer: real pointer-anchored popover ────────────
  if (isDesktop && anchorToPointer) {
    const triggerNode = React.isValidElement(trigger)
      ? React.cloneElement(trigger as React.ReactElement<React.HTMLAttributes<HTMLElement>>, {
          onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
            const prev = (trigger.props as React.HTMLAttributes<HTMLElement>).onPointerDown;
            if (typeof prev === 'function') prev(e);
            setPointerAnchor({ x: e.clientX, y: e.clientY });
          },
        })
      : trigger;

    // Compute anchor point from pointer coords, or fall back to trigger center
    const resolvedAnchor =
      pointerAnchor ??
      (triggerEl
        ? (() => {
            const r = triggerEl.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          })()
        : null);

    const toggleOpen = () => {
      if (!pointerAnchor && triggerEl) {
        const r = triggerEl.getBoundingClientRect();
        setPointerAnchor({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
      handleOpenChange(!open);
    };

    return (
      <>
        <div
          ref={setTriggerEl}
          onClick={toggleOpen}
          className="w-full"
          data-testid="picker-pointer-trigger-wrap"
        >
          {triggerNode}
        </div>
        <Popover open={open} onOpenChange={handleOpenChange}>
          {open && resolvedAnchor ? (
            <PopoverAnchor
              aria-hidden
              data-testid="picker-pointer-anchor"
              style={{
                position: 'fixed',
                left: resolvedAnchor.x,
                top: resolvedAnchor.y,
                width: 1,
                height: 1,
                pointerEvents: 'none',
              }}
            />
          ) : null}
          <PopoverContent
            className={cn('p-0', contentClassName)}
            align="center"
            {...(side ? { side } : {})}
          >
            {children}
          </PopoverContent>
        </Popover>
      </>
    );
  }

  // ── Desktop (standard) ──────────────────────────────────────────────────
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

  // ── Mobile (drawer) ─────────────────────────────────────────────────────
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      nested
      repositionInputs={false}
      handleOnly
      container={portalContainer ?? undefined}
    >
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
