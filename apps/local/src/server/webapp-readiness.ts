import { waitForHttpHealth, type HttpHealthResult } from './http-health.js';
import type { LogLine } from '../shared/protocol.js';

export type WebappReadinessResult = HttpHealthResult;

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

function webappRootUrl(webappUrl: string): string {
  return `${webappUrl.replace(/\/$/, '')}/`;
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
  return waitForHttpHealth(webappRootUrl(webappUrl), {
    intervalMs,
    maxAttempts,
    onCheck,
    redirect: 'follow',
    timeoutReason: 'timed out waiting for webapp HTTP response',
  });
}
