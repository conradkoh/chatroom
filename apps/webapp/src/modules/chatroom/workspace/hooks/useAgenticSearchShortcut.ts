'use client';

import { useEffect } from 'react';

// fallow-ignore-next-line complexity
function isAgenticSearchShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  if (event.shiftKey || event.altKey) return false;
  return true;
}

/**
 * Registers Cmd/Ctrl+F to open agentic search.
 * Uses capture phase so standalone PWA / browser "find in page" does not win the shortcut.
 */
export function useAgenticSearchShortcut(onOpen: () => void): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAgenticSearchShortcut(event)) return;

      event.preventDefault();
      event.stopPropagation();
      onOpen();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onOpen]);
}
