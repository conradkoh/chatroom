'use client';

import { useEffect } from 'react';

function isNewSessionShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey) return false;
  if (event.altKey) return false;
  if (event.key.toLowerCase() !== 'n') return false;
  return true;
}

export function useNewSessionShortcut(handlers: { onNewSession: () => void }): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isNewSessionShortcut(event)) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onNewSession();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handlers.onNewSession]);
}
