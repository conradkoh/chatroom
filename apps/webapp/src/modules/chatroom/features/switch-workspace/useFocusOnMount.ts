'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Moves focus to a stage heading when the stage mounts (same pattern as ImportDialog's
 * requestAnimationFrame focus). Keeps keyboard users on the new stage's content.
 */
export function useFocusOnMount(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const frame = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ref]);
}
