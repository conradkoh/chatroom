'use client';

import { useState, useEffect } from 'react';

import { formatLastSeen } from '../components/AgentPanel/AgentStatusRow';

/**
 * Hook that returns a human-readable relative time string ("5m ago", "just now", etc.)
 * for a given unix-ms timestamp. Internally ticks every `intervalMs` to keep the
 * display fresh without requiring a DB write.
 *
 * Returns "never" when `timestamp` is null/undefined.
 */
export function useRelativeTime(timestamp: number | null | undefined, intervalMs = 30_000): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return formatLastSeen(timestamp);
}
