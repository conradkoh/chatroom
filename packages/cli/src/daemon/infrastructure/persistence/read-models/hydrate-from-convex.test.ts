import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { openDatabase } from '../open-database.js';
import { hydrateReadModelsFromConvex } from './hydrate-from-convex.js';
import { listTaskReadModelsForMachine } from './tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-hydrate-'));
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

describe('hydrateReadModelsFromConvex', () => {
  it('upserts task rows from the Convex snapshot query', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const query = vi.fn().mockResolvedValue({
        tasks: [rawSnapshotRow(), rawSnapshotRow({ taskId: 'task-2' })],
      });

      const result = await hydrateReadModelsFromConvex({
        db,
        machineId: 'machine-1',
        sessionId: 'sess-1',
        query,
      });

      expect(result.taskCount).toBe(2);
      expect(query).toHaveBeenCalledWith(expect.anything(), {
        sessionId: 'sess-1',
        machineId: 'machine-1',
      });
      const rows = listTaskReadModelsForMachine(db, 'machine-1');
      expect(rows.map((r) => r.taskId).sort()).toEqual(['task-1', 'task-2']);
      expect(rows[0]).toMatchObject({
        status: 'pending',
        role: 'builder',
        agentHarness: 'opencode',
        machineId: 'machine-1',
      });
    } finally {
      db.close();
    }
  });

  it('is idempotent — re-hydrating upserts without duplicates', async () => {
    const db = openDatabase(tempDbPath());
    try {
      const query = vi.fn().mockResolvedValue({ tasks: [rawSnapshotRow()] });
      const deps = { db, machineId: 'machine-1', sessionId: 'sess-1', query };

      await hydrateReadModelsFromConvex(deps);
      await hydrateReadModelsFromConvex(deps);

      expect(listTaskReadModelsForMachine(db, 'machine-1')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
