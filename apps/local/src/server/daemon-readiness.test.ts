import { describe, it, expect } from 'vitest';

import { waitForDaemonReadyFromLogs } from './daemon-readiness.js';
import type { LogLine } from '../shared/protocol.js';

function daemonLog(text: string, stream: 'stdout' | 'stderr' = 'stdout'): LogLine {
  return {
    processId: 'daemon',
    stream,
    text,
    timestamp: Date.now(),
  };
}

describe('waitForDaemonReadyFromLogs', () => {
  it('resolves when listening line appears', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForDaemonReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) => handler(daemonLog('\nListening for commands...')));

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('ignores listening line from other processes', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForDaemonReadyFromLogs(
      (handler) => {
        handlers.push(handler);
        return () => {};
      },
      { timeoutMs: 50 }
    );

    handlers.forEach((handler) =>
      handler({
        processId: 'webapp',
        stream: 'stdout',
        text: 'Listening for commands...',
        timestamp: Date.now(),
      })
    );

    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'timed out waiting for daemon ready',
    });
  });

  it('rejects on authentication timeout', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForDaemonReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) =>
      handler(daemonLog('❌ Authentication timeout (5 minutes). Exiting.', 'stderr'))
    );

    await expect(promise).resolves.toEqual({
      ok: false,
      reason: '❌ Authentication timeout (5 minutes). Exiting.',
    });
  });

  it('rejects on daemon already running', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForDaemonReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) =>
      handler(daemonLog('❌ Daemon already running for http://127.0.0.1:3210', 'stderr'))
    );

    await expect(promise).resolves.toEqual({
      ok: false,
      reason: expect.stringContaining('Daemon already running'),
    });
  });
});
