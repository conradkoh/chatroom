import type { DatabaseSync } from 'node:sqlite';

import type { EventStreamQuery } from '../../daemon/domain/entities/event-stream-query.js';

type LogEntryRow = {
  id: number | bigint;
  timestamp: number | bigint;
  level: string;
  source: string;
  stream?: string | null;
  message: string;
  metadata_json?: string | null;
};
type StringValueRow = { v: string | null };
type SourceRow = { source: string };
type EventStreamEntryRow = {
  id: number | bigint;
  timestamp: number | bigint;
  type: string;
  payload_json: string;
};

export type LogEntry = {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  stream?: 'stdout' | 'stderr';
  message: string;
  metadata?: Record<string, unknown>;
};
export type StoredLogEntry = LogEntry & { id: number };
export type LogQuery = {
  afterId?: number;
  beforeId?: number;
  source?: string;
  chatroomId?: string;
  role?: string;
  harness?: string;
  fromTimestamp?: number;
  toTimestamp?: number;
  limit?: number;
};
export type LogDimensions = { chatroomIds: string[]; roles: string[]; harnesses: string[] };
export type ChatroomEventRecord = Record<string, unknown> & {
  type: string;
  timestamp: number;
};
export type EventStreamEntry = {
  id: number;
  timestamp: number;
  type: string;
  payload: ChatroomEventRecord;
};
const clamp = (n = 100) => Math.max(1, Math.min(1000, Math.floor(n)));
const map = (row: LogEntryRow): StoredLogEntry => ({
  id: Number(row.id),
  timestamp: Number(row.timestamp),
  level: row.level as LogEntry['level'],
  source: row.source,
  ...(row.stream ? { stream: row.stream as LogEntry['stream'] } : {}),
  message: row.message,
  ...(row.metadata_json ? { metadata: JSON.parse(row.metadata_json) } : {}),
});
export function appendBatch(db: DatabaseSync, entries: LogEntry[]): void {
  if (!entries.length) return;
  db.exec('BEGIN');
  try {
    const stmt = db.prepare(
      'INSERT INTO log_entries(timestamp,level,source,stream,message,metadata_json) VALUES(?,?,?,?,?,?)'
    );
    for (const e of entries)
      stmt.run(
        e.timestamp,
        e.level,
        e.source,
        e.stream ?? null,
        e.message,
        e.metadata ? JSON.stringify(e.metadata) : null
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function appendChatroomEvent(db: DatabaseSync, event: ChatroomEventRecord): EventStreamEntry {
  const result = db.prepare('INSERT INTO event_stream_entries(timestamp,type,payload_json) VALUES(?,?,?)').run(
    event.timestamp,
    event.type,
    JSON.stringify(event)
  );
  return { id: Number(result.lastInsertRowid), timestamp: event.timestamp, type: event.type, payload: event };
}
export function queryEventStream(db: DatabaseSync, input: EventStreamQuery): EventStreamEntry[] {
  const filters = [
    "AND json_extract(payload_json, '$.chatroomId') = ?",
    input.afterId !== undefined ? 'AND id > ?' : '',
    input.beforeId !== undefined ? 'AND id < ?' : '',
    input.type ? 'AND type = ?' : '',
    input.fromTimestamp !== undefined ? 'AND timestamp >= ?' : '',
    input.toTimestamp !== undefined ? 'AND timestamp <= ?' : '',
  ].join(' ');
  const values = [
    input.chatroomId,
    ...(input.afterId !== undefined ? [input.afterId] : []),
    ...(input.beforeId !== undefined ? [input.beforeId] : []),
    ...(input.type ? [input.type] : []),
    ...(input.fromTimestamp !== undefined ? [input.fromTimestamp] : []),
    ...(input.toTimestamp !== undefined ? [input.toTimestamp] : []),
    clamp(input.limit),
  ];
  const rows = db
    .prepare(`SELECT * FROM event_stream_entries WHERE 1=1 ${filters} ORDER BY id DESC LIMIT ?`)
    .all(...values) as EventStreamEntryRow[];
  return rows.reverse().map((row) => ({
    id: Number(row.id),
    timestamp: Number(row.timestamp),
    type: row.type,
    payload: JSON.parse(row.payload_json) as ChatroomEventRecord,
  }));
}
export function queryAfterId(
  db: DatabaseSync,
  afterId = 0,
  limit = 100,
  source?: string,
  chatroomId?: string,
  role?: string,
  harness?: string,
  fromTimestamp?: number,
  toTimestamp?: number
): StoredLogEntry[] {
  const filters = [
    source ? 'AND source = ?' : '',
    chatroomId ? "AND json_extract(metadata_json, '$.chatroomId') = ?" : '',
    role ? "AND json_extract(metadata_json, '$.role') = ?" : '',
    harness ? "AND (json_extract(metadata_json, '$.harness') = ? OR source = ?)" : '',
    fromTimestamp !== undefined ? 'AND timestamp >= ?' : '',
    toTimestamp !== undefined ? 'AND timestamp <= ?' : '',
  ].join(' ');
  const values = [
    afterId,
    ...(source ? [source] : []),
    ...(chatroomId ? [chatroomId] : []),
    ...(role ? [role] : []),
    ...(harness ? [harness, `harness:${harness}`] : []),
    ...(fromTimestamp !== undefined ? [fromTimestamp] : []),
    ...(toTimestamp !== undefined ? [toTimestamp] : []),
    clamp(limit),
  ];
  const rows = db
    .prepare(`SELECT * FROM log_entries WHERE id > ? ${filters} ORDER BY id ASC LIMIT ?`)
    .all(...values);
  return (rows as LogEntryRow[]).map(map);
}
export function queryHistory(
  db: DatabaseSync,
  beforeId?: number,
  limit = 100,
  source?: string,
  chatroomId?: string,
  role?: string,
  harness?: string,
  fromTimestamp?: number,
  toTimestamp?: number
): StoredLogEntry[] {
  const filters = [
    beforeId ? 'AND id < ?' : '',
    source ? 'AND source = ?' : '',
    chatroomId ? "AND json_extract(metadata_json, '$.chatroomId') = ?" : '',
    role ? "AND json_extract(metadata_json, '$.role') = ?" : '',
    harness ? "AND (json_extract(metadata_json, '$.harness') = ? OR source = ?)" : '',
    fromTimestamp !== undefined ? 'AND timestamp >= ?' : '',
    toTimestamp !== undefined ? 'AND timestamp <= ?' : '',
  ].join(' ');
  const values = [
    ...(beforeId ? [beforeId] : []),
    ...(source ? [source] : []),
    ...(chatroomId ? [chatroomId] : []),
    ...(role ? [role] : []),
    ...(harness ? [harness, `harness:${harness}`] : []),
    ...(fromTimestamp !== undefined ? [fromTimestamp] : []),
    ...(toTimestamp !== undefined ? [toTimestamp] : []),
    clamp(limit),
  ];
  const rows = db
    .prepare(`SELECT * FROM log_entries WHERE 1=1 ${filters} ORDER BY id DESC LIMIT ?`)
    .all(...values);
  return (rows as LogEntryRow[]).map(map).reverse();
}
export function listLogDimensions(db: DatabaseSync, limit = 100): LogDimensions {
  const clamped = clamp(limit);
  const values = (sql: string) =>
    (db.prepare(sql).all(clamped) as StringValueRow[]).map((r) => r.v as string);
  const chatroomIds = values(
    "SELECT DISTINCT json_extract(metadata_json, '$.chatroomId') AS v FROM log_entries WHERE json_extract(metadata_json, '$.chatroomId') IS NOT NULL ORDER BY v LIMIT ?"
  );
  const roles = values(
    "SELECT DISTINCT json_extract(metadata_json, '$.role') AS v FROM log_entries WHERE json_extract(metadata_json, '$.role') IS NOT NULL ORDER BY v LIMIT ?"
  );
  const meta = values(
    "SELECT DISTINCT json_extract(metadata_json, '$.harness') AS v FROM log_entries WHERE json_extract(metadata_json, '$.harness') IS NOT NULL ORDER BY v LIMIT ?"
  );
  const source = values(
    "SELECT DISTINCT substr(source, 9) AS v FROM log_entries WHERE source LIKE 'harness:%' ORDER BY v LIMIT ?"
  );
  return { chatroomIds, roles, harnesses: [...new Set([...meta, ...source])].sort() };
}
export function listDistinctSources(db: DatabaseSync, limit = 100): string[] {
  return (
    db
      .prepare('SELECT DISTINCT source FROM log_entries ORDER BY source LIMIT ?')
      .all(clamp(limit)) as SourceRow[]
  ).map((r) => r.source);
}
