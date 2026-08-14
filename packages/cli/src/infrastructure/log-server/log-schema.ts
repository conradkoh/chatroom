export const SCHEMA_VERSION = 2;
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
  `CREATE TABLE IF NOT EXISTS chatroom_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatroom_id TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    machine_id TEXT,
    role TEXT,
    payload_json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chatroom_logs_chatroom_timestamp ON chatroom_logs(chatroom_id, timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_chatroom_logs_chatroom_type ON chatroom_logs(chatroom_id, type)`,
];
