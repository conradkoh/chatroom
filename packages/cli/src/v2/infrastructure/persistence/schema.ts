export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS outbound_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outbound_events_type ON outbound_events(event_type)`,
  `CREATE INDEX IF NOT EXISTS idx_outbound_events_created ON outbound_events(created_at)`,
  `CREATE TABLE IF NOT EXISTS outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outbound_event_id INTEGER NOT NULL,
    target TEXT NOT NULL DEFAULT 'convex',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (outbound_event_id) REFERENCES outbound_events(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status)`,
];
