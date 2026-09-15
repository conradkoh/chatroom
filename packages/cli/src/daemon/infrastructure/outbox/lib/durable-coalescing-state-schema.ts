export const DURABLE_COALESCING_STATE_SCHEMA_VERSION = 2;
export const DURABLE_COALESCING_STATE_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS coalescing_outbox_entries (delivery_key TEXT PRIMARY KEY, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS coalescing_outbox_quarantine (id INTEGER PRIMARY KEY AUTOINCREMENT, delivery_key TEXT NOT NULL, payload_json TEXT NOT NULL, last_error TEXT NOT NULL, quarantined_at INTEGER NOT NULL)`,
];
