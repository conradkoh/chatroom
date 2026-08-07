import { describe, it, expect } from 'vitest';

import { waitForWebappReadyFromLogs } from './webapp-readiness.js';
import type { LogLine } from '../shared/protocol.js';

function webappLog(text: string): LogLine {
  return {
    processId: 'webapp',
    stream: 'stdout',
    text,
    timestamp: Date.now(),
  };
}

describe('waitForWebappReadyFromLogs', () => {
  it('resolves when ready line appears', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForWebappReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) => handler(webappLog('✓ Ready in 60ms')));

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('detects local URL ready line', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForWebappReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) => handler(webappLog('- Local:         http://localhost:6249')));

    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not treat pre-start shell echo as ready', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForWebappReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) =>
      handler(webappLog('Starting Next.js production server on http://localhost:6249 ...'))
    );

    const result = await Promise.race([
      promise,
      new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 50)),
    ]);

    expect(result).toBe('pending');
  });

  it('rejects on start failure log line', async () => {
    const handlers: ((line: LogLine) => void)[] = [];
    const promise = waitForWebappReadyFromLogs((handler) => {
      handlers.push(handler);
      return () => {};
    });

    handlers.forEach((handler) =>
      handler(webappLog('Error: listen EADDRINUSE: address already in use :::3000'))
    );

    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'Error: listen EADDRINUSE: address already in use :::3000',
    });
  });
});
