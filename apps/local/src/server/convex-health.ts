import { checkHttpHealth, waitForHttpHealth, type HttpHealthResult } from './http-health.js';

export type ConvexHealthResult = HttpHealthResult;

function convexVersionUrl(convexUrl: string): string {
  return `${convexUrl.replace(/\/$/, '')}/version`;
}

export async function checkConvexHealth(
  convexUrl: string,
  timeoutMs = 3000
): Promise<ConvexHealthResult> {
  return checkHttpHealth(convexVersionUrl(convexUrl), { timeoutMs });
}

export async function waitForConvexHealthy(
  convexUrl: string,
  options: {
    intervalMs?: number;
    maxAttempts?: number;
    onCheck?: (attempt: number) => void;
  } = {}
): Promise<ConvexHealthResult> {
  const { intervalMs = 1000, maxAttempts = 120, onCheck } = options;
  return waitForHttpHealth(convexVersionUrl(convexUrl), {
    intervalMs,
    maxAttempts,
    onCheck,
    timeoutReason: 'timed out waiting for Convex',
  });
}
