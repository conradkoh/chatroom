import { describe, expect, it } from 'vitest';
import { createFifoBatchedOutbox } from './fifo-batched-outbox.js';
import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
describe('fifo batched outbox', () => {
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
    const a = o.enqueue(1),
      b = o.enqueue(2);
    await expect(a).resolves.toBe(1);
    await expect(b).resolves.toBe(2);
    await o.stop();
    s.close();
  });
});
