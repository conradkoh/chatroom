import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
import { createKeyedFifoBatchedOutboxRegistry } from './keyed-fifo-batched-outbox-registry.js';
describe('keyed fifo registry', () => {
  it('delivers independent keys and closes store', async () => {
    const s = openDurableFifoQueueStore(join(mkdtempSync(join(tmpdir(), 'registry-')), 'q'));
    const r = createKeyedFifoBatchedOutboxRegistry({
      store: s,
      batchSize: 1,
      createSend: () => async (xs) => xs,
      serialize: JSON.stringify,
      deserialize: JSON.parse,
    });
    await expect(r.enqueue('a', 1)).resolves.toBe(1);
    await expect(r.enqueue('b', 2)).resolves.toBe(2);
    await r.stopAll();
  });
});
