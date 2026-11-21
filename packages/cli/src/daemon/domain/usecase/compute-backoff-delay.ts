/**
 * Shared exponential backoff for daemon-owned retry ladders.
 *
 * Callers pass their own bounds: provider-failure redelivery (5s base, 60s cap,
 * ±20% jitter below the cap and downward-only at it), role recovery (1s to 30s,
 * deterministic), bootstrap recovery (1s to 30s, deterministic), and respawn starts
 * (1s base, 10min SDK cap or 30s CLI cap, deterministic). The delay doubles per
 * attempt and is capped so an outage is absorbed without giving up.
 */
// The bounds are part of the helper's public contract (imported by its tests).
// fallow-ignore-next-line unused-export
export const REDELIVERY_BACKOFF_BASE_MS = 5_000;
// fallow-ignore-next-line unused-export
export const REDELIVERY_BACKOFF_MAX_MS = 60_000;

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /**
   * Jitter ratio (0.2 = ±20%). Omitted or 0 disables jitter. Below `maxMs` the delay
   * moves both ways by up to `ratio`. At or above `maxMs` it moves only downward, to
   * `maxMs * (1 - ratio)`, so it never exceeds the cap and retries do not pile up on it.
   */
  jitter?: number;
}

/** The provider-failure redelivery schedule: 5s base, 60s cap, ±20% below the cap, 48s–60s at it. */
export const REDELIVERY_BACKOFF_OPTIONS: BackoffOptions = {
  baseMs: REDELIVERY_BACKOFF_BASE_MS,
  maxMs: REDELIVERY_BACKOFF_MAX_MS,
  jitter: 0.2,
};

/**
 * Delay before the next attempt.
 *
 * `attempt` is 1-based (the first attempt waits `opts.baseMs`).
 * Returns the capped exponential delay, never negative, and never above `opts.maxMs`.
 * Jitter is applied before the final clamp: symmetric below the cap, downward-only at
 * or above it.
 */
export function computeBackoffDelay(
  attempt: number,
  opts: BackoffOptions,
  random: () => number = Math.random
): number {
  const raw = opts.baseMs * 2 ** (attempt - 1); // may be Infinity for huge attempts
  const exp = Math.min(opts.maxMs, raw);
  const jitterRatio = opts.jitter ?? 0;
  if (jitterRatio <= 0) return Math.max(0, Math.round(exp));
  // At the cap the offset is in [-1, 0]; below it, in [-1, 1).
  const offset = raw >= opts.maxMs ? -random() : random() * 2 - 1;
  return Math.min(opts.maxMs, Math.max(0, Math.round(exp + exp * jitterRatio * offset)));
}
