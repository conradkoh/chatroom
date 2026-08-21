export const SCHEMA_VERSION = 1;

export const MIGRATIONS: string[] = [
  `CREATE TABLE IF NOT EXISTS schema_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inbox_state (
    inbox_type TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    state_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (inbox_type, scope_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_state_type_updated
   ON inbox_state(inbox_type, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_state_updated
   ON inbox_state(updated_at DESC)`,
];
