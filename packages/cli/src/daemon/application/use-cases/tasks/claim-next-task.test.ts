import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { claimNextTask } from './claim-next-task.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { openDatabase } from '../../../infrastructure/persistence/open-database.js';
import {
  listTaskReadModelsForChatroomRole,
  upsertTaskReadModel,
} from '../../../infrastructure/persistence/read-models/tasks.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p6-claim-next-'));
  return join(dir, 'events.sqlite');
}

function makeTask(overrides?: Partial<Parameters<typeof upsertTaskReadModel>[1]>) {
  return {
    chatroomId: 'room-1',
    role: 'builder',
    taskId: 'task-1',
    status: 'pending' as const,
    assignedTo: 'builder',
    agentHarness: 'opencode',
    machineId: 'machine-1',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('claimNextTask', () => {
  it('claims the next pending task and appends a task.claimed event', () => {
    const db = openDatabase(tempDbPath());
    const events: OutboundEvent[] = [];
    try {
      upsertTaskReadModel(db, makeTask());
      const result = claimNextTask(
        { db, machineId: 'machine-1', appendEvent: (e) => events.push(e), now: () => 1000 },
        { chatroomId: 'room-1', role: 'builder' }
      );

      expect(result).toEqual({ success: true, taskId: 'task-1', status: 'acknowledged' });
      const row = listTaskReadModelsForChatroomRole(db, 'room-1', 'builder')[0];
      expect(row?.status).toBe('acknowledged');
      expect(events).toHaveLength(1);
      expect(events[0]?.type).toBe('task.claimed');
      if (events[0]?.type === 'task.claimed') {
        expect(events[0]).toMatchObject({
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-1',
        });
      }
    } finally {
      db.close();
    }
  });

  it('returns no_pending when no pending task exists for the role', () => {
    const db = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, makeTask({ status: 'acknowledged' }));
      const result = claimNextTask(
        { db, machineId: 'machine-1', appendEvent: () => {} },
        { chatroomId: 'room-1', role: 'planner' }
      );
      expect(result).toEqual({ success: false, code: 'no_pending' });
    } finally {
      db.close();
    }
  });

  it('returns already_claimed when the explicit task is not pending', () => {
    const db = openDatabase(tempDbPath());
    try {
      upsertTaskReadModel(db, makeTask({ status: 'acknowledged' }));
      const result = claimNextTask(
        { db, machineId: 'machine-1', appendEvent: () => {} },
        { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' }
      );
      expect(result).toEqual({ success: false, code: 'already_claimed' });
    } finally {
      db.close();
    }
  });
});
