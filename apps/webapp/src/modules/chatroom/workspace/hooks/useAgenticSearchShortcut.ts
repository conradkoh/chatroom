'use client';

import { useEffect } from 'react';

// fallow-ignore-next-line complexity
function isAgenticQueryShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (!event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  if (event.altKey) return false;
  return true;
}

export function useAgenticSearchShortcut(handlers: { onOpen: () => void }): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isAgenticQueryShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onOpen();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handlers.onOpen]);
}
