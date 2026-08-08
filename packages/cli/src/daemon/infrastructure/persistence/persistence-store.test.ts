import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createPersistenceStore } from './persistence-store.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-persistence-store-'));
  return join(dir, 'events.sqlite');
}

describe('createPersistenceStore', () => {
  it('append writes event and enqueues outbox pending row', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      store.append({
        type: 'turn.completed',
        harnessSessionId: 'hs-1',
        turnId: 'turn-1',
      });

      const pending = store.listPendingOutbox();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.target).toBe('convex');
    } finally {
      store.close();
    }
  });

  it('listHarnessStreamLines returns appended harness.stream events', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      const line = {
        type: 'harness.stream' as const,
        harness: 'h1',
        stream: 'stdout' as const,
        line: 'hello',
        timestamp: 42,
      };
      store.append(line);

      expect(store.listHarnessStreamLines()).toEqual([line]);
    } finally {
      store.close();
    }
  });

  it('does not enqueue outbox row for harness.stream (T0 local only)', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      store.append({
        type: 'harness.stream',
        harness: 'h1',
        stream: 'stdout',
        line: 'hello',
        timestamp: 1,
      });

      expect(store.listPendingOutbox()).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  it('enqueues outbox row for heartbeat (non-T0)', () => {
    const store = createPersistenceStore(tempDbPath());
    try {
      store.append({ type: 'heartbeat', machineId: 'm-1' });

      const pending = store.listPendingOutbox();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.target).toBe('convex');
    } finally {
      store.close();
    }
  });
});
