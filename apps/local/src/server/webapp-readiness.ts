import type { LogLine } from '../shared/protocol.js';

export type WebappReadinessResult = { ok: true } | { ok: false; reason: string };

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function isWebappReadyLogLine(text: string): boolean {
  const plain = stripAnsi(text);
  // Only match lines emitted once the server is actually listening — not the pre-start echo
  // from process-definitions ("Starting Next.js production server on ...").
  return plain.includes('Ready in') || /\bLocal:\s+http:\/\/localhost:\d+/i.test(plain);
}

function isWebappFailureLogLine(text: string): boolean {
  const plain = stripAnsi(text);
  return plain.includes('Failed to start server') || plain.includes('EADDRINUSE');
}

export function waitForWebappReadyFromLogs(
  subscribe: (handler: (line: LogLine) => void) => () => void,
  options: {
    timeoutMs?: number;
    onWaiting?: () => void;
  } = {}
): Promise<WebappReadinessResult> {
  const { timeoutMs = 180_000, onWaiting } = options;
  onWaiting?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: WebappReadinessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'timed out waiting for webapp server ready' });
    }, timeoutMs);

    const unsubscribe = subscribe((line) => {
      if (line.processId !== 'webapp') return;
      if (isWebappFailureLogLine(line.text)) {
        finish({ ok: false, reason: stripAnsi(line.text).slice(0, 200) });
        return;
      }
      if (isWebappReadyLogLine(line.text)) {
        finish({ ok: true });
      }
    });
  });
}

async function checkWebappHttp(
  webappUrl: string,
  timeoutMs = 3000
): Promise<WebappReadinessResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${webappUrl.replace(/\/$/, '')}/`, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (res.ok) return { ok: true };
    return { ok: false, reason: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'unknown error' };
  } finally {
    clearTimeout(timer);
  }
}

export async function waitForWebappHttpReady(
  webappUrl: string,
  options: {
    intervalMs?: number;
    maxAttempts?: number;
    onCheck?: (attempt: number) => void;
  } = {}
): Promise<WebappReadinessResult> {
  const { intervalMs = 500, maxAttempts = 120, onCheck } = options;
  let lastReason = 'timed out waiting for webapp HTTP response';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onCheck?.(attempt);
    const result = await checkWebappHttp(webappUrl);
    if (result.ok) return result;
    lastReason = result.reason;
    if (attempt < maxAttempts) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  return { ok: false, reason: lastReason };
}
