/**
 * Exponential backoff for provider-failure redelivery.
 *
 * A failed provider turn releases the task back to `pending`; releasing it
 * immediately spends the attempt budget while the provider is still failing.
 * The delay before each release grows by a factor of two and is capped so a
 * multi-minute outage is absorbed without parking the task.
 */
// The bounds are part of the helper's public contract (imported by its tests).
// fallow-ignore-next-line unused-export
export const RETRY_BACKOFF_BASE_MS = 5_000;
// fallow-ignore-next-line unused-export
export const RETRY_BACKOFF_MAX_MS = 5 * 60_000;

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Jitter ratio (0.2 = ±20%). Omitted or 0 disables jitter. */
  jitter?: number;
}

/** The provider-failure redelivery schedule: 5s base, 5min cap, ±20%. */
export const REDELIVERY_BACKOFF_OPTIONS: BackoffOptions = {
  baseMs: RETRY_BACKOFF_BASE_MS,
  maxMs: RETRY_BACKOFF_MAX_MS,
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
