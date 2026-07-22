import type { LogLine } from '../shared/protocol.js';

export type WebappReadinessResult = { ok: true } | { ok: false; reason: string };

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

function isWebappReadyLogLine(text: string): boolean {
  const plain = stripAnsi(text);
  return (
    plain.includes('Ready in') ||
    /\bLocal:\s+http:\/\/localhost:\d+/i.test(plain) ||
    /Starting Next\.js production server on http:\/\/localhost:\d+/i.test(plain)
  );
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
