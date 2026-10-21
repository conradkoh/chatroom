// fallow-ignore-file unused-file
/**
 * Exponential backoff for provider-failure redelivery.
 *
 * A failed provider turn releases the task back to `pending`; releasing it
 * immediately spends the attempt budget while the provider is still failing.
 * The delay before each release grows by a factor of two and is capped so a
 * multi-minute outage is absorbed without parking the task.
 */
export const RETRY_BACKOFF_BASE_MS = 5_000;
export const RETRY_BACKOFF_MAX_MS = 5 * 60_000;

/**
 * Delay before releasing a task after a provider failure.
 *
 * `attempt` is 1-based (the first failure waits `RETRY_BACKOFF_BASE_MS`).
 * Returns the capped exponential delay with ±20% jitter, never negative.
 * The jitter is applied after the cap, so the result can exceed
 * `RETRY_BACKOFF_MAX_MS` by at most 20%.
 */
export function computeBackoffDelay(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(RETRY_BACKOFF_MAX_MS, RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1));
  const jitter = exp * 0.2 * (random() * 2 - 1);
  return Math.max(0, Math.round(exp + jitter));
}
