import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { createFifoBatchedOutbox } from './fifo-batched-outbox.js';

describe('fifo batched outbox', () => {
  it('retries conflict with updated payload until success', async () => {
    vi.useFakeTimers();
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    let attempt = 0;
    const o = createFifoBatchedOutbox({
      batchSize: 1,
      store: s,
      deliveryKey: 'k',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send: async () => {
        attempt++;
        return attempt === 1
          ? [{ status: 'conflict', revision: 99 }]
          : [{ status: 'applied', revision: 100 }];
      },
      classifyOutcome: (result, item) =>
        result.status === 'conflict'
          ? { kind: 'retry', item: { ...item, baseRevision: result.revision } }
          : { kind: 'success' },
    });
    const p = o.enqueue({ baseRevision: 1 });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toEqual({ status: 'applied', revision: 100 });
    await o.stop();
    s.close();
    vi.useRealTimers();
  });
  it('retries thrown sends on a timer without re-enqueue', async () => {
    vi.useFakeTimers();
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    let calls = 0;
    const o = createFifoBatchedOutbox({
      batchSize: 1,
      store: s,
      deliveryKey: 'k',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      retryDelayMs: 100,
      send: async () => {
        calls++;
        if (calls === 1) throw new Error('fail');
        return [{ ok: true }];
      },
    });
    const p = o.enqueue({ x: 1 });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await expect(p).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    await o.stop();
    s.close();
    vi.useRealTimers();
  });
  it('resets retry backoff after a successful batch before the next failure', async () => {
    vi.useFakeTimers();
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    let calls = 0;
    const o = createFifoBatchedOutbox({
      batchSize: 1,
      store: s,
      deliveryKey: 'k',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      retryDelayMs: 100,
      maxRetryDelayMs: 1000,
      send: async () => {
        calls++;
        if (calls === 1 || calls === 3) throw new Error('fail');
        return [{ ok: true }];
      },
    });
    const first = o.enqueue({ x: 1 });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);

    const second = o.enqueue({ x: 2 });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(99);
    expect(calls).toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toEqual({ ok: true });
    expect(calls).toBe(4);

    await o.stop();
    s.close();
    vi.useRealTimers();
  });
  it('preserves partial batches for a later drain', async () => {
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    let calls = 0;
    const o = createFifoBatchedOutbox({
      batchSize: 2,
      store: s,
      deliveryKey: 'k',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send: async (xs) => {
        calls++;
        return calls === 1 ? [xs[0]] : xs;
      },
    });
    const a = o.enqueue(1);
    const b = o.enqueue(2);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    await o.stop();
    s.close();
  });
});
