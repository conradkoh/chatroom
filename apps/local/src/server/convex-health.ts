export type ConvexHealthResult = { ok: true } | { ok: false; reason: string };

export async function checkConvexHealth(
  convexUrl: string,
  timeoutMs = 3000
): Promise<ConvexHealthResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${convexUrl.replace(/\/$/, '')}/version`, {
      signal: controller.signal,
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
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
  let lastReason = 'timed out waiting for Convex';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onCheck?.(attempt);
    const result = await checkConvexHealth(convexUrl);
    if (result.ok) return result;
    lastReason = result.reason;
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { ok: false, reason: lastReason };
}
