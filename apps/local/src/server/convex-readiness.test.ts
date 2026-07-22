import { describe, it, expect, vi } from 'vitest';

import { waitForConvexDevReadyFromLogs } from './convex-readiness.js';
import type { LogLine } from '../shared/protocol.js';

function createSubscriber() {
  const listeners: ((line: LogLine) => void)[] = [];
  const subscribe = (handler: (line: LogLine) => void) => {
    listeners.push(handler);
    return () => {
      const index = listeners.indexOf(handler);
      if (index >= 0) listeners.splice(index, 1);
    };
  };
  const emit = (line: LogLine) => {
    for (const listener of listeners) listener(line);
  };
  return { subscribe, emit };
}

describe('waitForConvexDevReadyFromLogs', () => {
  it('resolves on plain readiness line', async () => {
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 1000 });
    emit({
      processId: 'convex',
      stream: 'stderr',
      text: 'Convex functions ready! (7.22s)',
      timestamp: Date.now(),
    });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('resolves on readiness line with timestamp prefix', async () => {
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 1000 });
    emit({
      processId: 'convex',
      stream: 'stderr',
      text: '10:30:18 Convex functions ready! (7.22s)',
      timestamp: Date.now(),
    });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('resolves on readiness line with ANSI codes from convex dev stderr', async () => {
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 1000 });
    emit({
      processId: 'convex',
      stream: 'stderr',
      text: '\x1b[32m✔\x1b[39m 10:30:18 Convex functions ready! (7.22s)',
      timestamp: Date.now(),
    });
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it('does not resolve on preparing message', async () => {
    vi.useFakeTimers();
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 500 });
    emit({
      processId: 'convex',
      stream: 'stderr',
      text: '- Preparing Convex functions...',
      timestamp: Date.now(),
    });
    vi.advanceTimersByTime(500);
    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'timed out waiting for Convex functions ready',
    });
    vi.useRealTimers();
  });

  it('rejects on port in use', async () => {
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 1000 });
    emit({
      processId: 'convex',
      stream: 'stderr',
      text: 'Error: listen EADDRINUSE: address already in use :::3210',
      timestamp: Date.now(),
    });
    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'Error: listen EADDRINUSE: address already in use :::3210',
    });
  });

  it('ignores readiness logs from other processes', async () => {
    vi.useFakeTimers();
    const { subscribe, emit } = createSubscriber();
    const promise = waitForConvexDevReadyFromLogs(subscribe, { timeoutMs: 500 });
    emit({
      processId: 'webapp',
      stream: 'stderr',
      text: 'Convex functions ready! (7.22s)',
      timestamp: Date.now(),
    });
    vi.advanceTimersByTime(500);
    await expect(promise).resolves.toEqual({
      ok: false,
      reason: 'timed out waiting for Convex functions ready',
    });
    vi.useRealTimers();
  });
});
