import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { DURABLE_COALESCING_STATE_MIGRATIONS } from './durable-coalescing-state-schema.js';

export type DurableCoalescingStateStore = {
  upsertPending(key: string, payloadJson: string): void;
  getPending(key: string): { payloadJson: string; attempts: number } | null;
  markDone(key: string): void;
  markPendingRetry(key: string, error: unknown): void;
  listPendingKeys(): string[];
  close(): void;
};
export function openDurableCoalescingStateStore(path: string): DurableCoalescingStateStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  for (const sql of DURABLE_COALESCING_STATE_MIGRATIONS) db.exec(sql);
  db.prepare(
    "UPDATE coalescing_outbox_entries SET status='pending' WHERE status='in_flight'"
  ).run();
  return {
    upsertPending: (key, payload) => {
      const now = Date.now();
      db.prepare(
        "INSERT INTO coalescing_outbox_entries(delivery_key,payload_json,status,created_at,updated_at) VALUES(?,?,'pending',?,?) ON CONFLICT(delivery_key) DO UPDATE SET payload_json=excluded.payload_json,status='pending',updated_at=excluded.updated_at"
      ).run(key, payload, now, now);
    },
    getPending: (key) =>
      (db
        .prepare(
          "SELECT payload_json as payloadJson, attempts FROM coalescing_outbox_entries WHERE delivery_key=? AND status IN ('pending','in_flight')"
        )
        .get(key) as { payloadJson: string; attempts: number } | undefined) ?? null,
    markDone: (key) => {
      db.prepare('DELETE FROM coalescing_outbox_entries WHERE delivery_key=?').run(key);
    },
    markPendingRetry: (key, error) => {
      db.prepare(
        "UPDATE coalescing_outbox_entries SET status='pending',last_error=?,attempts=attempts+1,updated_at=? WHERE delivery_key=?"
      ).run(String(error), Date.now(), key);
    },
    listPendingKeys: () =>
      db
        .prepare(
          "SELECT delivery_key as key FROM coalescing_outbox_entries WHERE status IN ('pending','in_flight')"
        )
        .all()
        .map((r) => String((r as { key: string }).key)),
    close: () => db.close(),
  };
}
