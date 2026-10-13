'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Focuses the first enabled input or button inside `containerRef` when the step mounts.
 * Each wizard step calls this so keyboard users land on the step's first control.
 */
export function useFocusFirstControl(containerRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    containerRef.current
      ?.querySelector<HTMLElement>('input:not([disabled]), button:not([disabled])')
      ?.focus();
  }, [containerRef]);
}
