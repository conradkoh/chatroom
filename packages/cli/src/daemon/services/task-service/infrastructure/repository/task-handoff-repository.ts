import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Durable latest-handoff record for one daemon-owned role in one chatroom.
 *
 * SQLite schema (`task_handoffs`):
 * - `chatroom_id` + normalized `role` form the primary key, so each role has
 *   exactly one latest record per chatroom;
 * - `task_ids_json` stores the task ids completed by the handoff;
 * - `next_task_id` and `target_role` describe the task created for the target;
 * - `handed_off_at` is the daemon clock timestamp used for diagnostics/order.
 *
 * The repository deliberately stores only the latest handoff. Task definitions
 * and server task history remain outside this daemon-local projection.
 */
export interface TaskHandoffRecord {
  readonly chatroomId: string;
  readonly role: string;
  readonly taskIds: readonly string[];
  readonly nextTaskId?: string | undefined;
  readonly targetRole: string;
  readonly handedOffAt: number;
}

export interface TaskHandoffRepository {
  record(record: TaskHandoffRecord): Promise<void>;
  getLatest(chatroomId: string, role: string): Promise<TaskHandoffRecord | null>;
  close(): void;
}

type HandoffRow = {
  chatroom_id: string;
  role: string;
  task_ids_json: string;
  next_task_id: string | null;
  target_role: string;
  handed_off_at: number;
};

function normalizeRole(role: string): string {
  return role.toLowerCase();
}

function mapRow(row: HandoffRow): TaskHandoffRecord {
  const taskIds: unknown = JSON.parse(row.task_ids_json);
  if (!Array.isArray(taskIds) || !taskIds.every((taskId) => typeof taskId === 'string')) {
    throw new Error('Invalid task handoff task_ids_json');
  }
  return {
    chatroomId: row.chatroom_id,
    role: row.role,
    taskIds,
    ...(row.next_task_id ? { nextTaskId: row.next_task_id } : {}),
    targetRole: row.target_role,
    handedOffAt: row.handed_off_at,
  };
}

export function createTaskHandoffRepository(dbPath: string): TaskHandoffRepository {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_handoffs (
      chatroom_id TEXT NOT NULL,
      role TEXT NOT NULL,
      task_ids_json TEXT NOT NULL,
      next_task_id TEXT,
      target_role TEXT NOT NULL,
      handed_off_at INTEGER NOT NULL,
      PRIMARY KEY (chatroom_id, role)
    )
  `);
  return {
    async record(record) {
      db.prepare(
        `INSERT INTO task_handoffs
           (chatroom_id, role, task_ids_json, next_task_id, target_role, handed_off_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chatroom_id, role) DO UPDATE SET
           task_ids_json = excluded.task_ids_json,
           next_task_id = excluded.next_task_id,
           target_role = excluded.target_role,
           handed_off_at = excluded.handed_off_at`
      ).run(
        record.chatroomId,
        normalizeRole(record.role),
        JSON.stringify(record.taskIds),
        record.nextTaskId ?? null,
        record.targetRole,
        record.handedOffAt
      );
    },
    async getLatest(chatroomId, role) {
      const row = db
        .prepare(
          'SELECT chatroom_id, role, task_ids_json, next_task_id, target_role, handed_off_at FROM task_handoffs WHERE chatroom_id = ? AND role = ?'
        )
        .get(chatroomId, normalizeRole(role)) as HandoffRow | undefined;
      return row ? mapRow(row) : null;
    },
    close() {
      db.close();
    },
  };
}

/** Test/fallback implementation for compositions that do not provide SQLite. */
export function createInMemoryTaskHandoffRepository(): TaskHandoffRepository {
  const records = new Map<string, TaskHandoffRecord>();
  return {
    async record(record) {
      records.set(`${record.chatroomId}:${normalizeRole(record.role)}`, {
        ...record,
        role: normalizeRole(record.role),
        taskIds: [...record.taskIds],
      });
    },
    async getLatest(chatroomId, role) {
      return records.get(`${chatroomId}:${normalizeRole(role)}`) ?? null;
    },
    close() {},
  };
}
