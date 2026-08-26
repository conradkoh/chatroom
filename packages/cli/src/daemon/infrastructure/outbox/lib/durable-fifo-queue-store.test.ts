import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

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
  it('updatePayload persists revised JSON for a pending row', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'outbox-')), 'q.sqlite');
    const s = openDurableFifoQueueStore(path);
    const id = s.enqueue('k', JSON.stringify({ baseRevision: 1 }));
    s.updatePayload(id, JSON.stringify({ baseRevision: 99 }));
    expect(JSON.parse(s.claimNextBatch('k', 1)[0]!.payloadJson)).toEqual({ baseRevision: 99 });
    s.close();
  });
});
