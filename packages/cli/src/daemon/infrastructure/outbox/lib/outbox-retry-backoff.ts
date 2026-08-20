/** Caps the exponent so `2 ** attempt` cannot overflow to Infinity. */
const MAX_RETRY_EXPONENT = 20;

export function computeExponentialRetryDelayMs(
  attempt: number,
  retryDelayMs: number,
  maxRetryDelayMs: number
): number {
  const exponent = Math.min(Math.max(0, attempt), MAX_RETRY_EXPONENT);
  return Math.min(retryDelayMs * 2 ** exponent, maxRetryDelayMs);
}
