'use client';

import { useEffect } from 'react';

/** True when only Alt is held and the physical key matches (KeyboardEvent.code). */
// fallow-ignore-next-line unused-export complexity
export function isAltShortcut(event: KeyboardEvent, code: string): boolean {
  if (!event.altKey) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey) return false;
  return event.code === code;
}

export interface UseAltShortcutOptions {
  /** Physical key code, e.g. KeyN for Alt+N. Prefer code over key for macOS Option shortcuts. */
  code: string;
  enabled?: boolean;
  onTrigger: () => void;
}

/** Register a global Alt+key shortcut during the capture phase. */
export function useAltShortcut({ code, enabled = true, onTrigger }: UseAltShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAltShortcut(event, code)) return;
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [code, enabled, onTrigger]);
}
