'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect if the viewport is at or above the desktop breakpoint (1024px).
 * Handles SSR gracefully by defaulting to false (mobile-first).
 *
 * @param breakpoint - The minimum width in pixels to be considered desktop (default: 1024)
 * @returns boolean - true if viewport is >= breakpoint
 */
export function useIsDesktop(breakpoint = 1024): boolean {
  // Default to false for SSR
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    // Check if window is available (client-side)
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia(`(min-width: ${breakpoint}px)`);

    // Set initial value
    setIsDesktop(mediaQuery.matches);

    // Handler for media query changes
    const handleChange = (e: MediaQueryListEvent) => {
      setIsDesktop(e.matches);
    };

    // Add listener
    mediaQuery.addEventListener('change', handleChange);

    // Cleanup
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [breakpoint]);

  return isDesktop;
}
