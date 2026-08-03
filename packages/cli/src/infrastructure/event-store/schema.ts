/**
 * Event Store schema (SQLite, default DELETE journal mode — no WAL).
 */

const SCHEMA_VERSION = 1;

const EVENTS_TABLE = `
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  chatroom_id TEXT NOT NULL,
  machine_id TEXT NOT NULL,
  type TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  payload TEXT NOT NULL
)`;

const INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_events_chatroom_timestamp ON events (chatroom_id, timestamp DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_events_machine_type_timestamp ON events (machine_id, type, timestamp DESC)`,
];

const SCHEMA_VERSION_TABLE = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
)`;

export const EVENT_STORE_DDL = [
  EVENTS_TABLE,
  SCHEMA_VERSION_TABLE,
  `INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION})`,
  ...INDEXES,
];
