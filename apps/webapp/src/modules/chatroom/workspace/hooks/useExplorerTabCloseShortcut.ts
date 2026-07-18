'use client';

import { useEffect } from 'react';

// fallow-ignore-next-line complexity
export function isExplorerTabCloseShortcut(event: KeyboardEvent): boolean {
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey || event.altKey) return false;
  return event.key.toLowerCase() === 'w';
}

export function isAppNavigationTarget(target: EventTarget | null): boolean {
  const check = (el: EventTarget | null): boolean => {
    if (!(el instanceof HTMLElement)) return false;
    return el.closest('[data-app-navigation]') !== null;
  };
  return check(target) || check(document.activeElement);
}

export interface UseExplorerTabCloseShortcutOptions {
  enabled: boolean;
  activeTabKey: string | null;
  onCloseTab: (key: string) => void;
}

export function useExplorerTabCloseShortcut({
  enabled,
  activeTabKey,
  onCloseTab,
}: UseExplorerTabCloseShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!isExplorerTabCloseShortcut(event)) return;
      if (isAppNavigationTarget(event.target)) return;
      if (!activeTabKey) return;

      event.preventDefault();
      event.stopPropagation();
      onCloseTab(activeTabKey);
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [enabled, activeTabKey, onCloseTab]);
}
