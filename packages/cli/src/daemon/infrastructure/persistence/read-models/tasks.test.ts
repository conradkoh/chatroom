import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDatabase } from '../open-database.js';
import {
  listTaskReadModelsForChatroomRole,
  listTaskReadModelsForMachine,
  taskReadModelFromSnapshot,
  taskReadModelToSnapshot,
  upsertTaskReadModel,
} from './tasks.js';
import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-read-models-'));
  return join(dir, 'events.sqlite');
}

function makeSnapshot(overrides?: Partial<AssignedTaskSnapshotView>): AssignedTaskSnapshotView {
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
    participant: {
      lastSeenAction: 'idle',
      lastSeenAt: 180,
      lastStatus: 'waiting',
    },
    ...overrides,
  };
}

describe('read model tasks', () => {
  it('round-trips snapshot -> row -> snapshot', () => {
    const snapshot = makeSnapshot();
    expect(taskReadModelToSnapshot(taskReadModelFromSnapshot(snapshot))).toEqual(snapshot);
  });

  it('round-trips snapshot without participant or assignedTo', () => {
    const snapshot = makeSnapshot({ assignedTo: undefined, participant: undefined });
    expect(taskReadModelToSnapshot(taskReadModelFromSnapshot(snapshot))).toEqual(snapshot);
  });

  it('upserts and lists by machine', () => {
    const db = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot()));
      upsertTaskReadModel(
        db,
        taskReadModelFromSnapshot(
          makeSnapshot({
            taskId: 'task-2',
            agentConfig: { ...makeSnapshot().agentConfig, role: 'planner' },
          })
        )
      );

      const rows = listTaskReadModelsForMachine(db, 'machine-1');
      expect(rows.map((r) => r.taskId).sort()).toEqual(['task-1', 'task-2']);
      expect(listTaskReadModelsForMachine(db, 'machine-other')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('upsert overwrites existing row for same composite key', () => {
    const db = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot({ status: 'pending' })));
      upsertTaskReadModel(db, taskReadModelFromSnapshot(makeSnapshot({ status: 'in_progress' })));

      const rows = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder');
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('in_progress');
    } finally {
      db.close();
    }
  });
});
