import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { getEnhancerQueuePort, setEnhancerQueueDb } from './enhancer-queue.js';
import { openDatabase } from './open-database.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'p4-enhancer-queue-'));
  return join(dir, 'events.sqlite');
}

function makeQueue() {
  const db = openDatabase(tempDbPath());
  setEnhancerQueueDb(db);
  return { db, queue: getEnhancerQueuePort() };
}

describe('createEnhancerQueue', () => {
  afterEach(() => {
    setEnhancerQueueDb(undefined);
  });

  it('enqueues, claims, completes a job', () => {
    const { db, queue } = makeQueue();
    try {
      queue.enqueue({
        jobId: 'local:room-1:msg-1',
        chatroomId: 'room-1',
        machineId: 'machine-1',
        payload: { agentHarness: 'opencode', model: 'gpt-4', machineId: 'machine-1' },
      });

      const pending = queue.listPendingForMachine('machine-1');
      expect(pending).toHaveLength(1);
      expect(pending[0]?.payload.agentHarness).toBe('opencode');

      const claimed = queue.claimPendingForMachine('machine-1');
      expect(claimed?.jobId).toBe('local:room-1:msg-1');
      expect(claimed?.status).toBe('claimed');

      // Only one job claimed at a time
      expect(queue.claimPendingForMachine('machine-1')).toBeNull();

      queue.markComplete(claimed!.jobId);
      expect(queue.listPendingForMachine('machine-1')).toHaveLength(0);

      const row = db
        .prepare(`SELECT status FROM enhancer_queue WHERE job_id = ?`)
        .get(claimed!.jobId) as { status: string };
      expect(row.status).toBe('complete');
    } finally {
      db.close();
    }
  });

  it('enqueue is idempotent per job id', () => {
    const { db, queue } = makeQueue();
    try {
      const input = {
        jobId: 'local:room-1:msg-1',
        chatroomId: 'room-1',
        machineId: 'machine-1',
        payload: { agentHarness: 'opencode', model: 'gpt-4', machineId: 'machine-1' },
      };
      queue.enqueue(input);
      queue.enqueue(input);
      expect(queue.listPendingForMachine('machine-1')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
