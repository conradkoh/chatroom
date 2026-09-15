import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { createKeyedFifoBatchedOutboxRegistry } from './keyed-fifo-batched-outbox-registry.js';

describe('keyed fifo registry', () => {
  it('recovers an in-flight key after stopping it without reopening the store', async () => {
    const store = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'registry-')), 'q'));
    const blocked = vi.fn(() => new Promise<number[]>(() => {}));
    const delivered = vi.fn(async (items: number[]) => items);
    let reconnect = false;
    const registry = createKeyedFifoBatchedOutboxRegistry({
      store,
      batchSize: 1,
      createSend: () => (reconnect ? delivered : blocked),
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
    await registry.enqueue('a', 1);
    await vi.waitFor(() => expect(blocked).toHaveBeenCalledOnce());
    await registry.stop('a');
    reconnect = true;
    await registry.flushNow('a');
    expect(delivered).toHaveBeenCalledExactlyOnceWith([1]);
    await registry.stopAll();
  });
  it('delivers independent keys and closes store', async () => {
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'registry-')), 'q'));
    const r = createKeyedFifoBatchedOutboxRegistry({
      store: s,
      batchSize: 1,
      createSend: () => async (xs) => xs,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
    await expect(r.enqueueAndWait('a', 1)).resolves.toBe(1);
    await expect(r.enqueueAndWait('b', 2)).resolves.toBe(2);
    await r.stopAll();
  });
});
