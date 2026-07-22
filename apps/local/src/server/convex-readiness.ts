import type { LogLine } from '../shared/protocol.js';

export type ConvexReadinessResult = { ok: true } | { ok: false; reason: string };

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

/** True when convex dev has finished preparing functions (process keeps running). */
function isConvexDevReadyLogLine(text: string): boolean {
  return stripAnsi(text).includes('Convex functions ready!');
}

export function waitForConvexDevReadyFromLogs(
  subscribe: (handler: (line: LogLine) => void) => () => void,
  options: {
    timeoutMs?: number;
    onWaiting?: () => void;
  } = {}
): Promise<ConvexReadinessResult> {
  const { timeoutMs = 120_000, onWaiting } = options;
  onWaiting?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: ConvexReadinessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'timed out waiting for Convex functions ready' });
    }, timeoutMs);

    const unsubscribe = subscribe((line) => {
      if (line.processId !== 'convex') return;
      if (isConvexDevReadyLogLine(line.text)) {
        finish({ ok: true });
      }
    });
  });
}
