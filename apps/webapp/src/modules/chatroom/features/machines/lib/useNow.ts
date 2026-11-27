'use client';

import { useEffect, useState } from 'react';

/**
 * One ticking clock for deadline-driven copy.
 *
 * Returns `Date.now()` and re-renders every `intervalMs` while mounted. A non-positive interval
 * installs no timer (the value still updates on mount), so callers can opt out per view without
 * conditional hooks.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (intervalMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
