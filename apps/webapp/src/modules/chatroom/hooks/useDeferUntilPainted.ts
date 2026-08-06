'use client';

import { useEffect, useState } from 'react';

/**
 * Returns false on the first frame when `enabled` becomes true, then true after
 * two animation frames (post-paint). Used to defer heavy DOM until shell paints.
 */
export function useDeferUntilPainted(enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    let cancelled = false;
    const id1 = requestAnimationFrame(() => {
      const id2 = requestAnimationFrame(() => {
        if (!cancelled) setReady(true);
      });
      return () => cancelAnimationFrame(id2);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id1);
    };
  }, [enabled]);

  return ready;
}
