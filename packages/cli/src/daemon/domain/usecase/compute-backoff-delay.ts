/**
 * Shared exponential backoff for daemon-owned retry ladders.
 *
 * Callers pass their own bounds: provider-failure redelivery (5s base, 5min cap,
 * ±20% jitter), role recovery (1s to 30s, deterministic), bootstrap recovery
 * (1s to 30s, deterministic), and respawn starts (1s base, 10min SDK cap or
 * 30s CLI cap, deterministic). The delay doubles per attempt and is capped so
 * an outage is absorbed without giving up.
 */
// The bounds are part of the helper's public contract (imported by its tests).
// fallow-ignore-next-line unused-export
export const REDELIVERY_BACKOFF_BASE_MS = 5_000;
// fallow-ignore-next-line unused-export
export const REDELIVERY_BACKOFF_MAX_MS = 5 * 60_000;

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Jitter ratio (0.2 = ±20%). Omitted or 0 disables jitter. */
  jitter?: number;
}

/** The provider-failure redelivery schedule: 5s base, 5min cap, ±20%. */
export const REDELIVERY_BACKOFF_OPTIONS: BackoffOptions = {
  baseMs: REDELIVERY_BACKOFF_BASE_MS,
  maxMs: REDELIVERY_BACKOFF_MAX_MS,
  jitter: 0.2,
};

/**
 * Delay before the next attempt.
 *
 * `attempt` is 1-based (the first attempt waits `opts.baseMs`).
 * Returns the capped exponential delay, never negative. With jitter disabled
 * the result is deterministic; with jitter the ratio is applied after the cap,
 * so the result can exceed `opts.maxMs` by the jitter ratio.
 */
export function computeBackoffDelay(
  attempt: number,
  opts: BackoffOptions,
  random: () => number = Math.random
): number {
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** (attempt - 1));
  const jitterRatio = opts.jitter ?? 0;
  if (jitterRatio <= 0) return Math.max(0, Math.round(exp));
  const jitter = exp * jitterRatio * (random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}
