import type { DatabaseSync } from 'node:sqlite';

export type ChatroomLogEntry = {
  chatroomId: string;
  timestamp: number;
  type: string;
  payload: Record<string, unknown>;
  machineId?: string;
  role?: string;
};
export type StoredChatroomLogEntry = ChatroomLogEntry & { id: number };
export type ChatroomLogQuery = {
  chatroomId: string;
  type?: string;
  machineId?: string;
  role?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  beforeId?: number;
  afterId?: number;
  limit?: number;
};
const clamp = (n = 100) => Math.max(1, Math.min(1000, Math.floor(n)));
type Row = {
  id: number | bigint;
  chatroom_id: string;
  timestamp: number | bigint;
  type: string;
  machine_id?: string | null;
  role?: string | null;
  payload_json: string;
};
const map = (row: Row): StoredChatroomLogEntry => ({
  id: Number(row.id),
  chatroomId: row.chatroom_id,
  timestamp: Number(row.timestamp),
  type: row.type,
  ...(row.machine_id ? { machineId: row.machine_id } : {}),
  ...(row.role ? { role: row.role } : {}),
  payload: JSON.parse(row.payload_json) as Record<string, unknown>,
});
function filters(query: ChatroomLogQuery, order: 'before' | 'after') {
  const clauses = ['chatroom_id = ?'];
  const values: (string | number)[] = [query.chatroomId];
  if (query.type) {
    clauses.push('type = ?');
    values.push(query.type);
  }
  if (query.machineId) {
    clauses.push('machine_id = ?');
    values.push(query.machineId);
  }
  if (query.role) {
    clauses.push('role = ?');
    values.push(query.role);
  }
  if (query.fromTimestamp !== undefined) {
    clauses.push('timestamp >= ?');
    values.push(query.fromTimestamp);
  }
  if (query.toTimestamp !== undefined) {
    clauses.push('timestamp <= ?');
    values.push(query.toTimestamp);
  }
  if (order === 'before' && query.beforeId !== undefined) {
    clauses.push('id < ?');
    values.push(query.beforeId);
  }
  if (order === 'after' && query.afterId !== undefined) {
    clauses.push('id > ?');
    values.push(query.afterId);
  }
  return { where: clauses.join(' AND '), values };
}
export function appendChatroomLogBatch(db: DatabaseSync, entries: ChatroomLogEntry[]): void {
  if (!entries.length) return;
  db.exec('BEGIN');
  try {
    const stmt = db.prepare(
      'INSERT INTO chatroom_logs(chatroom_id,timestamp,type,machine_id,role,payload_json) VALUES(?,?,?,?,?,?)'
    );
    for (const e of entries)
      stmt.run(
        e.chatroomId,
        e.timestamp,
        e.type,
        e.machineId ?? null,
        e.role ?? null,
        JSON.stringify(e.payload)
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export function queryChatroomLogHistory(
  db: DatabaseSync,
  query: ChatroomLogQuery
): StoredChatroomLogEntry[] {
  const f = filters(query, 'before');
  const rows = db
    .prepare(`SELECT * FROM chatroom_logs WHERE ${f.where} ORDER BY id DESC LIMIT ?`)
    .all(...f.values, clamp(query.limit));
  return (rows as Row[]).map(map).reverse();
}
export function queryChatroomLogsAfterId(
  db: DatabaseSync,
  query: ChatroomLogQuery
): StoredChatroomLogEntry[] {
  const f = filters(query, 'after');
  return (
    db
      .prepare(`SELECT * FROM chatroom_logs WHERE ${f.where} ORDER BY id ASC LIMIT ?`)
      .all(...f.values, clamp(query.limit)) as Row[]
  ).map(map);
}
export function listChatroomLogTypes(db: DatabaseSync, chatroomId?: string, limit = 100): string[] {
  const sql = chatroomId
    ? 'SELECT DISTINCT type FROM chatroom_logs WHERE chatroom_id = ? ORDER BY type LIMIT ?'
    : 'SELECT DISTINCT type FROM chatroom_logs ORDER BY type LIMIT ?';
  const values = chatroomId ? [chatroomId, clamp(limit)] : [clamp(limit)];
  return (db.prepare(sql).all(...values) as { type: string }[]).map((row) => row.type);
}
