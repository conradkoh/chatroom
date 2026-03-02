'use client';

import { useState, useEffect } from 'react';

/** Chatrooms/agents unseen for longer than this are considered offline in the listing view. */
export const LAST_SEEN_ACTIVE_MS = 600_000; // 10 minutes

/**
 * Pure function — returns true if the agent was seen within LAST_SEEN_ACTIVE_MS.
 * Takes `now` as a parameter so it is testable and deterministic.
 * Use alongside `usePresenceTick()` to keep the result fresh over time.
 */
export function isAgentPresent(lastSeenAt: number | null, now: number): boolean {
  return lastSeenAt != null && now - lastSeenAt <= LAST_SEEN_ACTIVE_MS;
}

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
