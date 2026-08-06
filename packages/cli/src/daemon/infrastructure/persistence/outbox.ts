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
