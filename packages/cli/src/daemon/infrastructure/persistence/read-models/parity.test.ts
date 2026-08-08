import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import { describe, expect, it, vi } from 'vitest';

import { mapAssignedTaskSnapshotList } from '../../../../infrastructure/mappers/map-assigned-task.js';
import { openDatabase } from '../open-database.js';
import { hydrateReadModelsFromConvex } from './hydrate-from-convex.js';
import { listSnapshotViewsFromReadModels } from './task-snapshot-adapter.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-parity-'));
  return join(dir, 'events.sqlite');
}

function rawSnapshotRow(overrides?: Record<string, unknown>) {
  return {
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 200,
    createdAt: 100,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'opencode',
      model: 'gpt-4o',
      workingDir: '/workspace',
      spawnedAgentPid: 42,
      desiredState: 'running',
      circuitState: 'closed',
    },
    participant: { lastSeenAction: 'idle', lastSeenAt: 180, lastStatus: 'waiting' },
    ...overrides,
  };
}

describe('read model parity', () => {
  it('listSnapshotViewsFromReadModels deep-equals the original snapshot list after hydrate', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const raw = [
        rawSnapshotRow(),
        rawSnapshotRow({
          taskId: 'task-2',
          agentConfig: { role: 'planner', machineId: 'machine-1', agentHarness: 'opencode' },
        }),
      ];
      const query = vi.fn().mockResolvedValue({ tasks: raw });

      await hydrateReadModelsFromConvex({
        db,
        machineId: 'machine-1',
        sessionId: 'sess-1',
        query,
      });

      const expected = mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(raw));
      const views = listSnapshotViewsFromReadModels(db, 'machine-1');
      expect(views).toEqual(expected);
    } finally {
      db.close();
    }
  });
});
