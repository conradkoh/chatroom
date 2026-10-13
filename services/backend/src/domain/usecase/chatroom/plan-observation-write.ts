/**
 * Use Case: Plan Observation Write
 *
 * Decides whether recording a chatroom observation writes at all, and what it writes. A regular
 * heartbeat inside the throttle window is skipped, since every write invalidates the daemon's
 * subscriptions. A refresh always writes, because it must move `lastRefreshedAt`. A missing row is
 * always written.
 */

import { OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS } from '../../../../config/reliability';

interface ObservationFields {
  lastObservedAt: number;
  lastRefreshedAt?: number;
}

/** The fields to write for an observation at `now`. A refresh also sets `lastRefreshedAt`. */
function observationFields(now: number, isRefresh: boolean): ObservationFields {
  return isRefresh ? { lastObservedAt: now, lastRefreshedAt: now } : { lastObservedAt: now };
}

/** True once the last observation is at least the throttle window old. */
function isPastThrottleWindow(lastObservedAt: number, now: number): boolean {
  return now - lastObservedAt >= OBSERVATION_HEARTBEAT_MIN_INTERVAL_MS;
}

/**
 * The write for a chatroom observation, or `null` when the write is skipped. `existing` is the
 * current observation row, or `null` when there is none.
 */
export function planObservationWrite(
  existing: { lastObservedAt: number } | null,
  now: number,
  isRefresh: boolean
): ObservationFields | null {
  if (existing === null) return observationFields(now, isRefresh);
  if (!isRefresh && !isPastThrottleWindow(existing.lastObservedAt, now)) return null;
  return observationFields(now, isRefresh);
}
