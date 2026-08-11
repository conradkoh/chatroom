import type { DatabaseSync } from 'node:sqlite';

export type LogEntry = {
  timestamp: number;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: string;
  stream?: 'stdout' | 'stderr';
  message: string;
  metadata?: Record<string, unknown>;
};
export type StoredLogEntry = LogEntry & { id: number };
export type LogQuery = { afterId?: number; beforeId?: number; source?: string; limit?: number };
const clamp = (n = 100) => Math.max(1, Math.min(1000, Math.floor(n)));
const map = (row: any): StoredLogEntry => ({
  id: Number(row.id),
  timestamp: Number(row.timestamp),
  level: row.level,
  source: row.source,
  ...(row.stream ? { stream: row.stream } : {}),
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
export function queryAfterId(
  db: DatabaseSync,
  afterId = 0,
  limit = 100,
  source?: string
): StoredLogEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM log_entries WHERE id > ? ${source ? 'AND source = ?' : ''} ORDER BY id ASC LIMIT ?`
    )
    .all(...(source ? [afterId, source, clamp(limit)] : [afterId, clamp(limit)]));
  return rows.map(map);
}
export function queryHistory(
  db: DatabaseSync,
  beforeId?: number,
  limit = 100,
  source?: string
): StoredLogEntry[] {
  const rows = db
    .prepare(
      `SELECT * FROM log_entries WHERE 1=1 ${beforeId ? 'AND id < ?' : ''} ${source ? 'AND source = ?' : ''} ORDER BY id DESC LIMIT ?`
    )
    .all(...[...(beforeId ? [beforeId] : []), ...(source ? [source] : []), clamp(limit)]);
  return rows.map(map).reverse();
}
export function listDistinctSources(db: DatabaseSync, limit = 100): string[] {
  return db
    .prepare('SELECT DISTINCT source FROM log_entries ORDER BY source LIMIT ?')
    .all(clamp(limit))
    .map((r: any) => r.source);
}
