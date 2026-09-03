'use client';

// fallow-ignore-file unused-file

import { useEffect } from 'react';

/** True when only Alt is held and the key matches case-insensitively. */
// fallow-ignore-next-line complexity
export function isAltShortcut(event: KeyboardEvent, key: string): boolean {
  if (!event.altKey) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey) return false;
  return event.key.toLowerCase() === key.toLowerCase();
}

export interface UseAltShortcutOptions {
  key: string;
  enabled?: boolean;
  onTrigger: () => void;
}

/** Register a global Alt+key shortcut during the capture phase. */
export function useAltShortcut({ key, enabled = true, onTrigger }: UseAltShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAltShortcut(event, key)) return;
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [key, enabled, onTrigger]);
}
