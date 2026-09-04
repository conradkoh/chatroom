'use client';

import { useEffect } from 'react';

/** True on Windows — uses Alt shortcuts to avoid browser Ctrl+N/E conflicts. */
// fallow-ignore-next-line unused-export
export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.platform.toUpperCase().includes('WIN');
}

/** Human-readable shortcut label for tooltips (Ctrl+N on macOS/Linux, Alt+N on Windows). */
export function getComposerPreflightShortcutLabel(letter: 'N' | 'E'): string {
  const modifier = isWindowsPlatform() ? 'Alt' : 'Ctrl';
  return `${modifier}+${letter}`;
}

/**
 * Composer preflight shortcuts: Ctrl+key on macOS/Linux, Alt+key on Windows.
 * Matches physical key via KeyboardEvent.code.
 */
// fallow-ignore-next-line unused-export complexity
export function isComposerPreflightShortcut(event: KeyboardEvent, code: string): boolean {
  if (event.code !== code) return false;
  if (event.metaKey || event.shiftKey) return false;

  if (isWindowsPlatform()) {
    return event.altKey && !event.ctrlKey;
  }

  return event.ctrlKey && !event.altKey;
}

export interface UseComposerPreflightShortcutOptions {
  /** Physical key code, e.g. KeyN or KeyE. */
  code: string;
  enabled?: boolean;
  onTrigger: () => void;
}

/** Register a global composer preflight shortcut during the capture phase. */
export function useComposerPreflightShortcut({
  code,
  enabled = true,
  onTrigger,
}: UseComposerPreflightShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isComposerPreflightShortcut(event, code)) return;
      event.preventDefault();
      event.stopPropagation();
      onTrigger();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [code, enabled, onTrigger]);
}
