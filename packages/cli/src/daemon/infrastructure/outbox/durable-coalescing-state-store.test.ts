import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDurableCoalescingStateStore } from './durable-coalescing-state-store.js';
describe('durable coalescing state store', () => {
  it('supersedes payloads with one row per delivery key', () => {
    const store = openDurableCoalescingStateStore(join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite'));
    store.upsertPending('wd', JSON.stringify({ revision: 1 }));
    store.upsertPending('wd', JSON.stringify({ revision: 2 }));
    expect(store.getPending('wd')?.payloadJson).toBe(JSON.stringify({ revision: 2 }));
    store.markDone('wd');
    expect(store.getPending('wd')).toBeNull();
    store.close();
  });
  it('recovers pending keys after reopen', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'coalesce-')), 'cp.sqlite');
    let store = openDurableCoalescingStateStore(path);
    store.upsertPending('wd', '{}');
    store.close();
    store = openDurableCoalescingStateStore(path);
    expect(store.listPendingKeys()).toContain('wd');
    store.close();
  });
});
