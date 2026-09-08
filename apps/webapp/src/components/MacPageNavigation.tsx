'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Global macOS-only shortcut for browser-history navigation.
 * Ctrl+ArrowLeft goes back, Ctrl+ArrowRight goes forward.
 * Mounted once from the root layout; renders no UI.
 */
export function MacPageNavigation(): null {
  const router = useRouter();

  useEffect(() => {
    // Sequential guard clauses are the simplest correct shape for this shortcut filter.
    // fallow-ignore-next-line complexity
    const handleKeyDown = (event: KeyboardEvent) => {
      // Guard: this feature is deliberately macOS-only and must not hijack editing.
      if (!isMacOS() || event.defaultPrevented || isEditableTarget(event.target)) return;
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        router.back();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        router.forward();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [router]);

  return null;
}

// Exported for unit tests; the only production consumer is the handler above.
// fallow-ignore-next-line unused-export
export function isMacOS(): boolean {
  if (typeof window === 'undefined' || !window.navigator) return false;
  return /Mac/.test(window.navigator.platform) || /Mac OS X/.test(window.navigator.userAgent);
}

// Exported for unit tests; the only production consumer is the handler above.
// fallow-ignore-next-line unused-export
export function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.matches('input, textarea, select') ||
      target.isContentEditable ||
      !!target.closest('[contenteditable="true"]'))
  );
}
