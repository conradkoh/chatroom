import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createDaemonTaskId } from '../../../domain/entities/daemon-task-id.js';
import { openDatabase } from '../open-database.js';
import { listTaskReadModelsForChatroomRole } from './tasks.js';
import { backfillPendingTasksForChatroomRole } from './backfill-pending-tasks.js';

describe('backfillPendingTasksForChatroomRole', () => {
  it('stores canonical daemonTaskId in read model', async () => {
    const db = openDatabase(join(mkdtempSync(join(tmpdir(), 'backfill-')), 'db.sqlite'));
    const daemonTaskId = createDaemonTaskId();
    try {
      const count = await backfillPendingTasksForChatroomRole({
        db, machineId: 'm', sessionId: 's', query: vi.fn().mockResolvedValue([{
          _id: 'convex-task-id', daemonTaskId, chatroomId: 'room', status: 'pending', content: 'task', assignedTo: 'planner', createdAt: 1, updatedAt: 1,
        }]),
      }, 'room', 'planner');
      expect(count).toBe(1);
      expect(listTaskReadModelsForChatroomRole(db, 'room', 'planner')[0]?.taskId).toBe(daemonTaskId);
    } finally { db.close(); }
  });
});
