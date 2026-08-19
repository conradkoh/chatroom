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
  `CREATE TABLE IF NOT EXISTS event_stream_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_event_stream_entries_timestamp_id ON event_stream_entries(timestamp, id)`,
  `CREATE INDEX IF NOT EXISTS idx_event_stream_entries_chatroom_id ON event_stream_entries(json_extract(payload_json, '$.chatroomId'), id)`,
];
