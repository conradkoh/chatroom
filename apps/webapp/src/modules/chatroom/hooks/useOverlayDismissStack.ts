// fallow-ignore-file unused-file
'use client';

import { useEffect, useRef } from 'react';

import { popOverlayDismiss, pushOverlayDismiss } from '../components/shared/overlayDismissStack';

/**
 * Register a dismiss handler while an overlay layer is open.
 * Used by portaled menus so Escape closes the menu before parent modals.
 */
export function useOverlayDismissStack(isOpen: boolean, onDismiss: () => void): void {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    if (!isOpen) return;

    const handler = () => onDismissRef.current();
    pushOverlayDismiss(handler);
    return () => popOverlayDismiss(handler);
  }, [isOpen]);
}
