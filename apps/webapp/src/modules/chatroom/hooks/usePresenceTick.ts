'use client';

import { useState, useEffect } from 'react';

/** Chatrooms/agents unseen for longer than this are considered offline in the listing view. */
export const LAST_SEEN_ACTIVE_MS = 600_000; // 10 minutes

/**
 * Hook that returns a monotonically-increasing tick counter, updated every
 * `intervalMs` milliseconds. Include this in useMemo dependencies to
 * re-evaluate time-based checks (e.g. lastSeenAt) on each tick without
 * needing a DB write.
 */
export function usePresenceTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return tick;
}
