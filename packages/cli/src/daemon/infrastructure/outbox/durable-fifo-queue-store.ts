import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DURABLE_FIFO_QUEUE_MIGRATIONS } from './durable-fifo-queue-schema.js';
export type DurableFifoQueueEntry = {
  id: number;
  deliveryKey: string;
  payloadJson: string;
  attempts: number;
};
export type DurableFifoQueueStore = {
  enqueue(key: string, payloadJson: string): number;
  claimNextBatch(key: string, limit: number): DurableFifoQueueEntry[];
  markDone(id: number): void;
  markPending(id: number): void;
  markPendingRetry(id: number, error: unknown): void;
  listPendingForRecovery(key: string): DurableFifoQueueEntry[];
  close(): void;
};
export function openDurableFifoQueueStore(dbPath: string): DurableFifoQueueStore {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  for (const sql of DURABLE_FIFO_QUEUE_MIGRATIONS) db.exec(sql);
  db.prepare(
    "UPDATE fifo_outbox_entries SET status='pending', updated_at=? WHERE status='in_flight'"
  ).run(Date.now());
  return {
    enqueue: (key, payloadJson) => {
      const now = Date.now();
      return Number(
        (
          db
            .prepare(
              'INSERT INTO fifo_outbox_entries(delivery_key,payload_json,created_at,updated_at) VALUES(?,?,?,?) RETURNING id'
            )
            .get(key, payloadJson, now, now) as { id: number }
        ).id
      );
    },
    claimNextBatch: (key, limit) =>
      db
        .prepare(
          "UPDATE fifo_outbox_entries SET status='in_flight', attempts=attempts+1, updated_at=? WHERE id IN (SELECT id FROM fifo_outbox_entries WHERE delivery_key=? AND status='pending' ORDER BY id LIMIT ?) RETURNING id, delivery_key as deliveryKey, payload_json as payloadJson, attempts"
        )
        .all(Date.now(), key, limit) as DurableFifoQueueEntry[],
    markDone: (id) => {
      db.prepare('DELETE FROM fifo_outbox_entries WHERE id=?').run(id);
    },
    markPending: (id) => {
      db.prepare(
        "UPDATE fifo_outbox_entries SET status='pending', last_error=NULL, updated_at=? WHERE id=?"
      ).run(Date.now(), id);
    },
    markPendingRetry: (id, error) => {
      db.prepare(
        "UPDATE fifo_outbox_entries SET status='pending', last_error=?, updated_at=? WHERE id=?"
      ).run(String(error), Date.now(), id);
    },
    listPendingForRecovery: (key) =>
      db
        .prepare(
          "SELECT id, delivery_key as deliveryKey, payload_json as payloadJson, attempts FROM fifo_outbox_entries WHERE delivery_key=? AND status IN ('pending','in_flight') ORDER BY id"
        )
        .all(key) as DurableFifoQueueEntry[],
    close: () => db.close(),
  };
}
