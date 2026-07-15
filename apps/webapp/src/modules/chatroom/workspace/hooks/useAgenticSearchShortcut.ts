'use client';

import { useEffect } from 'react';

function isAgenticSearchShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  if (event.altKey) return false;
  return !event.shiftKey;
}

function isAgenticAskShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  if (event.altKey) return false;
  return event.shiftKey;
}

export function useAgenticSearchShortcut(handlers: {
  onOpenSearch: () => void;
  onOpenAsk: () => void;
}): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isAgenticAskShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onOpenAsk();
        return;
      }
      if (isAgenticSearchShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        handlers.onOpenSearch();
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [handlers.onOpenSearch, handlers.onOpenAsk]);
}
