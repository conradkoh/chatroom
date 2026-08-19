export const DURABLE_FIFO_QUEUE_SCHEMA_VERSION = 1;
export const DURABLE_FIFO_QUEUE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS fifo_outbox_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_key TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_fifo_outbox_pending ON fifo_outbox_entries(delivery_key, status, id)`,
];
