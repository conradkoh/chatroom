import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCoalescingStateOutbox } from './coalescing-state-outbox.js';
import { openDurableCoalescingStateStore } from './durable-coalescing-state-store.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('coalescing-state-outbox', () => {
  it('quarantines unreadable recovered state and accepts a new state for that key', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite');
    const store = openDurableCoalescingStateStore(path);
    store.upsertPending('wd', '{old');
    const send = vi.fn(async (state: number) => state);
    const outbox = createCoalescingStateOutbox({
      store,
      deliveryKey: 'wd',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
      minIntervalMs: 0,
      logger: { error: vi.fn() },
    });
    await outbox.enqueue(2);
    await outbox.flushNow();
    expect(send).toHaveBeenCalledExactlyOnceWith(2);
    await outbox.stop();
    store.close();
    const db = new DatabaseSync(path);
    expect(db.prepare('SELECT payload_json FROM coalescing_outbox_quarantine').all()).toEqual([
      { payload_json: '{old' },
    ]);
    db.close();
  });

  it.each(['success', 'transient', 'permanent'] as const)(
    'preserves a newer durable snapshot after an older send ends with %s',
    async (outcome) => {
      const path = join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite');
      const store = openDurableCoalescingStateStore(path);
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const send = vi.fn(async (state: number) => {
        if (state === 1) {
          await gate;
          if (outcome !== 'success') throw new Error(outcome);
        }
        return state;
      });
      const outbox = createCoalescingStateOutbox({
        store,
        deliveryKey: 'wd',
        serialize: JSON.stringify,
        deserialize: JSON.parse,
        send,
        minIntervalMs: 60_000,
        retryDelayMs: 60_000,
        isPermanentError: (error) => error instanceof Error && error.message === 'permanent',
        logger: { error: vi.fn() },
      });
      const first = outbox.enqueueAndWait(1);
      const firstResult = first.then(
        (value) => value,
        () => 'rejected'
      );
      const flush = outbox.flushNow().catch(() => undefined);
      await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1));
      await expect(outbox.enqueue(2)).resolves.toBeUndefined();
      release();
      await flush;
      // Stop before any next scheduled send: recovery must still find state 2.
      await outbox.stop();
      expect(await firstResult).toBe(outcome === 'success' ? 1 : 'rejected');
      expect(store.getPending('wd')?.payloadJson).toBe('2');
      store.close();
      const recoveredStore = openDurableCoalescingStateStore(path);
      const recoveredSend = vi.fn(async (state: number) => state);
      const recovered = createCoalescingStateOutbox({
        store: recoveredStore,
        deliveryKey: 'wd',
        serialize: JSON.stringify,
        deserialize: JSON.parse,
        send: recoveredSend,
      });
      await recovered.flushNow();
      expect(recoveredSend).toHaveBeenCalledExactlyOnceWith(2);
      await recovered.stop();
      recoveredStore.close();
    }
  );

  it('resolves delivery waiters with the newest state after a transient failure', async () => {
    let fail!: (error: Error) => void;
    const gate = new Promise<number>((_, reject) => {
      fail = reject;
    });
    const send = vi.fn(async (state: number) => (state === 1 ? gate : state));
    const outbox = createCoalescingStateOutbox({
      send,
      minIntervalMs: 0,
      logger: { error: vi.fn() },
    });
    const first = outbox.enqueueAndWait(1);
    const flush = outbox.flushNow().catch(() => undefined);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1));
    const second = outbox.enqueueAndWait(2);
    fail(new Error('temporary'));
    await flush;
    await outbox.flushNow();
    await expect(first).resolves.toBe(2);
    await expect(second).resolves.toBe(2);
    expect(send.mock.calls).toEqual([[1], [2]]);
    await outbox.stop();
  });
  it('recovers pending state from durable storage without re-enqueue', async () => {
    const store = openDurableCoalescingStateStore(
      join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite')
    );
    store.upsertPending('wd', JSON.stringify({ revision: 1 }));
    const send = vi.fn(async (state: { revision: number }) => state);
    const outbox = createCoalescingStateOutbox({
      store,
      deliveryKey: 'wd',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
      minIntervalMs: 0,
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ revision: 1 }));
    expect(store.getPending('wd')).toBeNull();
    await outbox.stop();
    store.close();
  });
  it('sends the first state immediately and coalesces a state queued in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstSend = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const send = vi.fn(async (state: number) => {
      if (state === 1) await firstSend;
      return state;
    });
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 0 });

    const first = outbox.enqueueAndWait(1);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(1));
    const second = outbox.enqueueAndWait(2);

    releaseFirst?.();
    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    expect(send.mock.calls.map(([state]) => state)).toEqual([1, 2]);

    await outbox.stop();
  });

  it('waits for the configured minimum interval between successful sends', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (state: number) => state);
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 100 });

    const first = outbox.enqueueAndWait(1);
    await vi.runOnlyPendingTimersAsync();
    await expect(first).resolves.toBe(1);

    const second = outbox.enqueueAndWait(2);
    await vi.advanceTimersByTimeAsync(99);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(second).resolves.toBe(2);
    expect(send).toHaveBeenCalledTimes(2);

    await outbox.stop();
  });

  it('explicitly flushes pending state before stopping', async () => {
    vi.useFakeTimers();
    const send = vi.fn(async (state: number) => state);
    const outbox = createCoalescingStateOutbox({ send, minIntervalMs: 100 });
    const pending = outbox.enqueueAndWait(1);
    await outbox.flushNow();
    await outbox.stop();
    await expect(pending).resolves.toBe(1);
    expect(send).toHaveBeenCalledWith(1);
  });

  it('retains the latest state and retries after a failed send', async () => {
    vi.useFakeTimers();
    const send = vi
      .fn<(state: number) => Promise<number>>()
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce(2);
    const onError = vi.fn();
    const outbox = createCoalescingStateOutbox({
      send,
      minIntervalMs: 0,
      retryDelayMs: 10,
      onError,
    });

    const result = outbox.enqueueAndWait(2);
    await vi.runOnlyPendingTimersAsync();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe(2);
    expect(send).toHaveBeenCalledTimes(2);

    await outbox.stop();
  });

  it('doubles the retry delay after consecutive failures', async () => {
    vi.useFakeTimers();
    const send = vi.fn<(state: number) => Promise<number>>().mockRejectedValue(new Error('fail'));
    const outbox = createCoalescingStateOutbox({
      send,
      minIntervalMs: 0,
      retryDelayMs: 10,
      maxRetryDelayMs: 80,
    });

    void outbox.enqueueAndWait(1).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(19);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(40);
    expect(send).toHaveBeenCalledTimes(4);

    await outbox.stop().catch(() => undefined);
  });

  it('honors persisted attempts before the first recovered send', async () => {
    vi.useFakeTimers();
    const store = openDurableCoalescingStateStore(
      join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite')
    );
    store.upsertPending('wd', JSON.stringify({ revision: 1 }));
    store.markPendingRetry('wd', new Error('prior'));
    store.markPendingRetry('wd', new Error('prior'));
    const send = vi.fn(async (state: { revision: number }) => state);
    const outbox = createCoalescingStateOutbox({
      store,
      deliveryKey: 'wd',
      serialize: JSON.stringify,
      deserialize: JSON.parse,
      send,
      minIntervalMs: 0,
      retryDelayMs: 10,
      maxRetryDelayMs: 80,
    });

    await vi.advanceTimersByTimeAsync(19);
    expect(send).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledWith({ revision: 1 });

    await outbox.stop();
    store.close();
  });
});
