import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { receiveUserMessage } from './receive-user-message.js';
import { upsertTaskReadModel } from '../../../infrastructure/persistence/read-models/tasks.js';
import { MIGRATIONS } from '../../../infrastructure/persistence/schema.js';

function openTestDb(): DatabaseSync {
  const dir = mkdtempSync(join(tmpdir(), 'p9-receive-user-message-'));
  const db = new DatabaseSync(join(dir, 'daemon.db'));
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
  return db;
}

describe('receiveUserMessage', () => {
  it('appends outbound event and upserts pending task read model', () => {
    const db = openTestDb();
    const result = receiveUserMessage(
      { db, machineId: 'machine-1' },
      {
        chatroomId: 'room-1',
        content: 'hello',
        ingressId: 'ingress-1',
        targetRole: 'planner',
      }
    );

    expect(result.queued).toBe(false);
    expect(result.outboundEvent?.type).toBe('user-message.received');
    if (result.outboundEvent?.type === 'user-message.received') {
      expect(result.outboundEvent.idempotencyKey).toBe('ingress-1');
    }

    const rows = db
      .prepare(`SELECT task_id as taskId, status FROM read_model_tasks WHERE chatroom_id = ?`)
      .all('room-1') as { taskId: string; status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('pending');
  });

  it('returns queued when an active task exists and P9_QUEUE is off', () => {
    const db = openTestDb();
    const now = Date.now();
    upsertTaskReadModel(db, {
      chatroomId: 'room-1',
      role: 'planner',
      taskId: 'active-task',
      status: 'in_progress',
      assignedTo: 'planner',
      agentHarness: 'opencode',
      machineId: 'machine-1',
      createdAt: now,
      updatedAt: now,
    });

    const result = receiveUserMessage(
      { db, machineId: 'machine-1' },
      {
        chatroomId: 'room-1',
        content: 'queued hello',
        ingressId: 'ingress-2',
      }
    );

    expect(result.queued).toBe(true);
    expect(result.outboundEvent).toBeUndefined();
  });
});
