import type { LogLine } from '../shared/protocol.js';

export type DaemonReadinessResult = { ok: true } | { ok: false; reason: string };

const ANSI_ESCAPE = /\x1b\[[0-9;]*m/g;

const DAEMON_FAILURE_PATTERNS = [
  'Authentication timeout',
  'New session is also invalid',
  'Daemon already running',
  'Failed to update daemon status',
] as const;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE, '');
}

/** True when the daemon command loop is listening for remote commands. */
function isDaemonReadyLogLine(text: string): boolean {
  return stripAnsi(text).includes('Listening for commands');
}

function isDaemonFailureLogLine(text: string): boolean {
  const plain = stripAnsi(text);
  return DAEMON_FAILURE_PATTERNS.some((pattern) => plain.includes(pattern));
}

export function waitForDaemonReadyFromLogs(
  subscribe: (handler: (line: LogLine) => void) => () => void,
  options: {
    timeoutMs?: number;
    onWaiting?: () => void;
  } = {}
): Promise<DaemonReadinessResult> {
  const { timeoutMs = 300_000, onWaiting } = options;
  onWaiting?.();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (result: DaemonReadinessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({ ok: false, reason: 'timed out waiting for daemon ready' });
    }, timeoutMs);

    const unsubscribe = subscribe((line) => {
      if (line.processId !== 'daemon') return;
      if (isDaemonFailureLogLine(line.text)) {
        finish({ ok: false, reason: stripAnsi(line.text).slice(0, 200) });
        return;
      }
      if (isDaemonReadyLogLine(line.text)) {
        finish({ ok: true });
      }
    });
  });
}
