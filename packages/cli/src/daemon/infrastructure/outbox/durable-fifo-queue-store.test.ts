import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurableFifoQueueStore } from './durable-fifo-queue-store.js';
describe('durable fifo queue store', () => {
  it('persists FIFO rows and recovers in-flight rows', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'q.sqlite');
    let s = openDurableFifoQueueStore(path);
    const a = s.enqueue('a', '1');
    s.enqueue('a', '2');
    expect(s.claimNextBatch('a', 2).map((x) => x.payloadJson)).toEqual(['1', '2']);
    s.markPending(a);
    s.close();
    s = openDurableFifoQueueStore(path);
    expect(s.listPendingForRecovery('a').length).toBe(2);
    s.markDone(a);
    expect(s.listPendingForRecovery('a').length).toBe(1);
    s.close();
  });
});
