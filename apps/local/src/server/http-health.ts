export type HttpHealthResult = { ok: true } | { ok: false; reason: string };

export async function checkHttpHealth(
  url: string,
  options: { timeoutMs?: number; redirect?: RequestRedirect } = {}
): Promise<HttpHealthResult> {
  const { timeoutMs = 3000, redirect } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      ...(redirect ? { redirect } : {}),
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForHttpHealth(
  url: string,
  options: {
    timeoutMs?: number;
    redirect?: RequestRedirect;
    intervalMs?: number;
    maxAttempts?: number;
    onCheck?: (attempt: number) => void;
    timeoutReason?: string;
  } = {}
): Promise<HttpHealthResult> {
  const {
    timeoutMs,
    redirect,
    intervalMs = 1000,
    maxAttempts = 120,
    onCheck,
    timeoutReason = 'timed out waiting for HTTP response',
  } = options;
  let lastReason = timeoutReason;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onCheck?.(attempt);
    const result = await checkHttpHealth(url, { timeoutMs, redirect });
    if (result.ok) return result;
    lastReason = result.reason;
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { ok: false, reason: lastReason };
}
