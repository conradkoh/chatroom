export const SCHEMA_VERSION = 1;
export const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS log_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    level TEXT NOT NULL,
    source TEXT NOT NULL,
    stream TEXT,
    message TEXT NOT NULL,
    metadata_json TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_log_entries_source_id ON log_entries(source, id)`,
];
