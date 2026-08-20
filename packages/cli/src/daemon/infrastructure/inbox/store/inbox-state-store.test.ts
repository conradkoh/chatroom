import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createInboxStateStore } from './inbox-state-store.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'chatroom-inbox-state-'));
  return join(dir, 'inboxes.sqlite');
}

describe('createInboxStateStore', () => {
  it('saves and retrieves state for an inbox instance', () => {
    const store = createInboxStateStore(tempDbPath());
    try {
      store.save({ inboxType: 'task', scopeKey: 'machine-1' }, { afterSignalKey: 'k-1' }, 10);

      expect(
        store.get<{ afterSignalKey: string }>({ inboxType: 'task', scopeKey: 'machine-1' })
      ).toEqual({
        inboxType: 'task',
        scopeKey: 'machine-1',
        state: { afterSignalKey: 'k-1' },
        createdAt: 10,
        updatedAt: 10,
      });
    } finally {
      store.close();
    }
  });

  it('queries multiple inbox types and scopes independently', () => {
    const store = createInboxStateStore(tempDbPath());
    try {
      store.save({ inboxType: 'task', scopeKey: 'machine-1' }, { cursor: 'a' }, 10);
      store.save({ inboxType: 'task', scopeKey: 'machine-2' }, { cursor: 'b' }, 20);
      store.save({ inboxType: 'workspace', scopeKey: 'machine-1' }, { cursor: 'c' }, 30);

      expect(store.query({ inboxType: 'task' }).map((row) => row.scopeKey)).toEqual([
        'machine-2',
        'machine-1',
      ]);
      expect(store.query({ scopePrefix: 'machine-' })).toHaveLength(3);
      expect(store.query({ updatedAfter: 20 }).map((row) => row.inboxType)).toEqual(['workspace']);
    } finally {
      store.close();
    }
  });

  it('replaces state while preserving the original creation timestamp', () => {
    const store = createInboxStateStore(tempDbPath());
    try {
      const key = { inboxType: 'task', scopeKey: 'machine-1' };
      store.save(key, { cursor: 'a' }, 10);
      store.save(key, { cursor: 'b' }, 20);

      expect(store.get(key)).toMatchObject({
        state: { cursor: 'b' },
        createdAt: 10,
        updatedAt: 20,
      });
    } finally {
      store.close();
    }
  });
});
