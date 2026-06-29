import { describe, expect, it } from 'vitest';

import { WorkingSnapshot } from './working-snapshot.js';

type Row = { id: string; status: string; heartbeatAt: number };
type Signal = { id: string; status: string };

function createTestSnapshot(): WorkingSnapshot<Row, Signal> {
  return new WorkingSnapshot({
    rowKey: (row) => row.id,
    signalKey: (signal) => signal.id,
    mergeSignal: (existing, signal) => {
      if (!existing) {
        return undefined;
      }
      return {
        ...existing,
        status: signal.status,
      };
    },
  });
}

describe('WorkingSnapshot', () => {
  it('replaces all rows on reconcile refresh', () => {
    const snapshot = createTestSnapshot();
    snapshot.replaceAll([{ id: 'a', status: 'open', heartbeatAt: 1 }]);
    expect(snapshot.getByKey('a')).toBeDefined();

    snapshot.replaceAll([]);
    expect(snapshot.getByKey('a')).toBeUndefined();
  });

  it('merges incremental signals while preserving reconcile-only fields', () => {
    const snapshot = createTestSnapshot();
    snapshot.replaceAll([{ id: 'a', status: 'open', heartbeatAt: 42 }]);

    const merged = snapshot.mergeSignal({ id: 'a', status: 'closed' });

    expect(merged?.status).toBe('closed');
    expect(merged?.heartbeatAt).toBe(42);
    expect(snapshot.getByKey('a')?.status).toBe('closed');
  });

  it('returns undefined when merging a signal with no base row', () => {
    const snapshot = createTestSnapshot();
    expect(snapshot.mergeSignal({ id: 'a', status: 'open' })).toBeUndefined();
  });
});
