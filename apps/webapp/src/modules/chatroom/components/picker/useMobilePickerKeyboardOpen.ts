'use client';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useVisualViewportKeyboardInset } from '@/hooks/useMobileKeyboard';

export function useMobilePickerKeyboardOpen(open: boolean): boolean {
  const isDesktop = useIsDesktop();
  const inset = useVisualViewportKeyboardInset(open && !isDesktop);
  return !isDesktop && inset > 0;
}
