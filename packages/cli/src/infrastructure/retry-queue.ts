/**
 * Retry Queue — wraps async calls with retry-with-backoff.
 *
 * Designed for lifecycle mutations where transient failures (network blips,
 * Convex cold starts) are expected and safe to retry.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULTS: Required<RetryOptions> = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
};

/**
 * Execute an async function with exponential backoff.
 * Returns the result on success, or undefined after all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions
): Promise<T | undefined> {
  const { maxRetries, baseDelayMs, maxDelayMs } = { ...DEFAULTS, ...opts };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === maxRetries) {
        console.warn(
          `[retry-queue] All ${maxRetries + 1} attempts exhausted: ${(e as Error).message}`
        );
        return undefined;
      }

      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return undefined;
}
