import type { DatabaseSync } from 'node:sqlite';

import type {
  EnhancerQueueJob,
  EnhancerQueueJobStatus,
  EnhancerQueuePort,
  EnqueueEnhancerQueueInput,
} from '../../application/ports/enhancer-queue.port.js';

type EnhancerQueueRow = {
  jobId: string;
  chatroomId: string;
  machineId: string;
  status: EnhancerQueueJobStatus;
  payloadJson: string;
  createdAt: number;
  updatedAt: number;
};

function rowToJob(row: EnhancerQueueRow): EnhancerQueueJob {
  return {
    jobId: row.jobId,
    chatroomId: row.chatroomId,
    machineId: row.machineId,
    status: row.status,
    payload: JSON.parse(row.payloadJson) as EnhancerQueueJob['payload'],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function createEnhancerQueue(db: DatabaseSync, now: () => number = Date.now): EnhancerQueuePort {
  const touch = (jobId: string, status: EnhancerQueueJobStatus): void => {
    db.prepare(`UPDATE enhancer_queue SET status = ?, updated_at = ? WHERE job_id = ?`).run(
      status,
      now(),
      jobId
    );
  };

  return {
    enqueue(input: EnqueueEnhancerQueueInput): void {
      const t = now();
      db.prepare(
        `INSERT OR IGNORE INTO enhancer_queue(job_id, chatroom_id, machine_id, status, payload_json, created_at, updated_at)
         VALUES(?, ?, ?, 'pending', ?, ?, ?)`
      ).run(input.jobId, input.chatroomId, input.machineId, JSON.stringify(input.payload), t, t);
    },

    claimPendingForMachine(machineId: string): EnhancerQueueJob | null {
      const row = db
        .prepare(
          `SELECT job_id as jobId, chatroom_id as chatroomId, machine_id as machineId,
                  status, payload_json as payloadJson, created_at as createdAt, updated_at as updatedAt
           FROM enhancer_queue
           WHERE machine_id = ? AND status = 'pending'
           ORDER BY created_at ASC LIMIT 1`
        )
        .get(machineId) as EnhancerQueueRow | undefined;
      if (!row) return null;
      touch(row.jobId, 'claimed');
      return rowToJob({ ...row, status: 'claimed' });
    },

    listPendingForMachine(machineId: string): EnhancerQueueJob[] {
      const rows = db
        .prepare(
          `SELECT job_id as jobId, chatroom_id as chatroomId, machine_id as machineId,
                  status, payload_json as payloadJson, created_at as createdAt, updated_at as updatedAt
           FROM enhancer_queue
           WHERE machine_id = ? AND status = 'pending'
           ORDER BY created_at ASC`
        )
        .all(machineId) as unknown as EnhancerQueueRow[];
      return rows.map(rowToJob);
    },

    markComplete(jobId: string): void {
      touch(jobId, 'complete');
    },

    markFailed(jobId: string, _error?: string): void {
      touch(jobId, 'failed');
    },
  };
}

/**
 * Module-level wiring for the daemon enhancer subscriber. start-daemon sets the
 * SQLite handle after persistence is created; job-subscriber reads it lazily.
 */
let enhancerQueueDb: DatabaseSync | undefined;

export function setEnhancerQueueDb(db: DatabaseSync | undefined): void {
  enhancerQueueDb = db;
}

export function getEnhancerQueuePort(): EnhancerQueuePort {
  if (!enhancerQueueDb) {
    throw new Error('Enhancer queue db not wired — setEnhancerQueueDb() not called');
  }
  return createEnhancerQueue(enhancerQueueDb);
}
