import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it, vi } from 'vitest';

import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { createFifoBatchedOutbox } from './fifo-batched-outbox.js';
import { isOutboxArgumentValidationError } from './outbox-failure.js';

describe('fifo batched outbox', () => {
  it('rejects enqueue if persistence fails without reporting acceptance or sending', async () => {
    const store = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    const send = vi.fn(async (items: number[]) => items);
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 1,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
    });
    vi.spyOn(store, 'enqueue').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(outbox.enqueue(1)).rejects.toThrow('disk full');
    expect(store.listPendingForRecovery('k')).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    await outbox.stop();
    store.close();
  });
  it('does not lose an enqueue from a delivery waiter while the drain is finishing', async () => {
    const store = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 1,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send: async (items: number[]) => items,
    });
    const result = outbox.enqueueAndWait(1).then(() => outbox.enqueueAndWait(2));
    await expect(result).resolves.toBe(2);
    await outbox.stop();
    store.close();
  });
  it('acknowledges persistence while delivery is blocked and preserves it on stop', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q');
    const store = openDurableFifoQueueStore(path);
    let release!: (items: number[]) => void;
    const send = vi.fn(
      () =>
        new Promise<number[]>((resolve) => {
          release = resolve;
        })
    );
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 1,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
    });
    await expect(outbox.enqueue(1)).resolves.toBeUndefined();
    expect(store.listPendingForRecovery('k').map((row) => row.payloadJson)).toEqual(['1']);
    const delivery = outbox.flushNow();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await expect(outbox.enqueue(2)).resolves.toBeUndefined();
    await outbox.stop();
    store.close();
    // A completion after disposal must not access the closed SQLite connection.
    release([1]);
    await delivery;
    const recovered = openDurableFifoQueueStore(path);
    expect(recovered.listPendingForRecovery('k').map((row) => row.payloadJson)).toEqual(['1', '2']);
    recovered.close();
  });

  it('quarantines a malformed recovered row without discarding valid batch neighbors', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q');
    const store = openDurableFifoQueueStore(path);
    store.enqueue('k', '{obsolete');
    store.enqueue('k', '2');
    const send = vi.fn(async (items: number[]) => items);
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 5,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
      logger: { error: vi.fn() },
    });
    await outbox.flushNow();
    expect(send).toHaveBeenCalledExactlyOnceWith([2]);
    expect(store.listPendingForRecovery('k')).toEqual([]);
    await outbox.stop();
    store.close();
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT payload_json, status FROM fifo_outbox_entries').all()).toEqual([
      { payload_json: '{obsolete', status: 'quarantined' },
    ]);
    db.close();
  });

  it('isolates permanent server rejections and delivers the other batch rows', async () => {
    const store = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    const delivered: number[] = [];
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 5,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      isPermanentError: isOutboxArgumentValidationError,
      logger: { error: vi.fn() },
      send: async (items: number[]) => {
        if (items.includes(2)) throw new Error('ArgumentValidationError: unsupported item');
        delivered.push(...items);
        return items;
      },
    });
    const first = outbox.enqueueAndWait(1);
    const invalid = expect(outbox.enqueueAndWait(2)).rejects.toThrow('ArgumentValidationError');
    const third = outbox.enqueueAndWait(3);
    await outbox.flushNow();
    await invalid;
    await expect(first).resolves.toBe(1);
    await expect(third).resolves.toBe(3);
    expect(delivered).toEqual([1, 3]);
    await outbox.stop();
    store.close();
  });

  it('retains retries even when failure callbacks throw and new items arrive', async () => {
    vi.useFakeTimers();
    const store = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'fifo-')), 'q'));
    const send = vi
      .fn<(items: number[]) => Promise<number[]>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(async (items) => items);
    const outbox = createFifoBatchedOutbox({
      store,
      deliveryKey: 'k',
      batchSize: 1,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
      retryDelayMs: 100,
      onError: () => {
        throw new Error('callback');
      },
      logger: {
        error: () => {
          throw new Error('logger');
        },
      },
    });
    await outbox.enqueue(1);
    await vi.advanceTimersByTimeAsync(0);
    await outbox.enqueue(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send.mock.calls).toEqual([[[1]], [[1]], [[2]]]);
    expect(store.listPendingForRecovery('k')).toEqual([]);
    await outbox.stop();
    store.close();
    vi.useRealTimers();
  });
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
    const p = o.enqueueAndWait({ baseRevision: 1 });
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
    const p = o.enqueueAndWait({ x: 1 });
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
    const first = o.enqueueAndWait({ x: 1 });
    await vi.runOnlyPendingTimersAsync();
    await vi.advanceTimersByTimeAsync(100);
    await expect(first).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);

    const second = o.enqueueAndWait({ x: 2 });
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
    const a = o.enqueueAndWait(1);
    const b = o.enqueueAndWait(2);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    await o.stop();
    s.close();
  });
});
