import type { DatabaseSync } from 'node:sqlite';

export type OutboxStatus = 'pending' | 'done' | 'failed';

export function enqueueOutbox(
  db: DatabaseSync,
  outboundEventId: number,
  target = 'convex'
): number {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO outbox(outbound_event_id, target, status, attempts, created_at, updated_at)
       VALUES(?, ?, 'pending', 0, ?, ?)`
    )
    .run(outboundEventId, target, now, now);
  return Number(result.lastInsertRowid);
}

export function listPendingOutbox(
  db: DatabaseSync,
  limit = 100
): {
  id: number;
  outboundEventId: number;
  target: string;
}[] {
  return db
    .prepare(
      `SELECT id, outbound_event_id as outboundEventId, target
       FROM outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?`
    )
    .all(limit) as { id: number; outboundEventId: number; target: string }[];
}

export function markOutboxDone(db: DatabaseSync, outboxId: number): void {
  const now = Date.now();
  db.prepare(`UPDATE outbox SET status = 'done', updated_at = ? WHERE id = ?`).run(now, outboxId);
}

export function markOutboxFailed(db: DatabaseSync, outboxId: number, error: string): void {
  const now = Date.now();
  db.prepare(
    `UPDATE outbox SET status = 'failed', last_error = ?, updated_at = ? WHERE id = ?`
  ).run(error, now, outboxId);
}

export function incrementOutboxAttempts(db: DatabaseSync, outboxId: number, error: string): number {
  const now = Date.now();
  db.prepare(
    `UPDATE outbox SET attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?`
  ).run(error, now, outboxId);
  const row = db.prepare(`SELECT attempts FROM outbox WHERE id = ?`).get(outboxId) as
    { attempts: number } | undefined;
  return row?.attempts ?? 0;
}
