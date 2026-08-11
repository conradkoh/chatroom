'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const STORAGE_PREFIX = 'scroll-pos:';

function getStorageKey(pathname: string, regionId: string): string {
  return `${STORAGE_PREFIX}${pathname}:${regionId}`;
}

function restoreScrollPosition(container: HTMLElement, storageKey: string): void {
  const saved = sessionStorage.getItem(storageKey);
  if (saved === null) return;

  const scrollTop = Number.parseInt(saved, 10);
  if (Number.isNaN(scrollTop)) return;

  requestAnimationFrame(() => {
    container.scrollTop = scrollTop;
  });
}

function saveScrollPosition(container: HTMLElement, storageKey: string): void {
  sessionStorage.setItem(storageKey, String(container.scrollTop));
}

/**
 * Preserves scroll position for a custom scroll container across back/forward navigation.
 * Forward navigations reset scroll to top; back/forward restores the saved offset.
 */
export function useScrollRestoration(
  containerRef: React.RefObject<HTMLElement | null>,
  regionId = 'main'
): void {
  const pathname = usePathname();
  const isBackNavigationRef = useRef(false);

  // Detect browser back/forward before Next.js updates the route
  useEffect(() => {
    const onPopState = () => {
      isBackNavigationRef.current = true;
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const storageKey = getStorageKey(pathname, regionId);

    if (isBackNavigationRef.current) {
      restoreScrollPosition(container, storageKey);
      isBackNavigationRef.current = false;
    } else {
      container.scrollTop = 0;
    }

    return () => saveScrollPosition(container, storageKey);
  }, [pathname, regionId, containerRef]);
}
