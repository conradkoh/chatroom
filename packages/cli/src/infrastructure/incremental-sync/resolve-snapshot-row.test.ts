import { describe, expect, it } from 'vitest';

import { resolveSnapshotRowForSignal } from './resolve-snapshot-row.js';
import { WorkingSnapshot } from './working-snapshot.js';

type Signal = { taskId: string; role: string; status: string };
type Row = { taskId: string; role: string; status: string };

describe('resolveSnapshotRowForSignal', () => {
  it('cold-hydrates when merge cannot bootstrap a row', async () => {
    const snapshot = new WorkingSnapshot<Row, Signal>({
      rowKey: (row) => `${row.taskId}:${row.role}`,
      signalKey: (signal) => `${signal.taskId}:${signal.role}`,
      mergeSignal: (existing, signal) => {
        if (!existing) {
          return { taskId: signal.taskId, role: signal.role, status: signal.status };
        }
        return { ...existing, status: signal.status };
      },
    });

    const row = await resolveSnapshotRowForSignal(
      snapshot,
      { taskId: 't1', role: 'builder', status: 'pending' },
      async () => []
    );

    expect(row).toEqual({ taskId: 't1', role: 'builder', status: 'pending' });
  });
});
