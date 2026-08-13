export const SCHEMA_VERSION = 4;

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
  `CREATE TABLE IF NOT EXISTS read_model_tasks (
    chatroom_id TEXT NOT NULL,
    role TEXT NOT NULL,
    task_id TEXT NOT NULL,
    status TEXT NOT NULL,
    assigned_to TEXT,
    agent_harness TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    model TEXT,
    working_dir TEXT,
    spawned_agent_pid INTEGER,
    desired_state TEXT,
    circuit_state TEXT,
    participant_last_seen_action TEXT,
    participant_last_seen_at INTEGER,
    participant_last_status TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chatroom_id, role, task_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_read_model_tasks_machine ON read_model_tasks(machine_id)`,
  `CREATE INDEX IF NOT EXISTS idx_read_model_tasks_status ON read_model_tasks(status)`,
  `CREATE TABLE IF NOT EXISTS read_model_participants (
    chatroom_id TEXT NOT NULL,
    role TEXT NOT NULL,
    turn_phase TEXT,
    last_seen_at INTEGER,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chatroom_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS read_model_agents (
    machine_id TEXT NOT NULL,
    role TEXT NOT NULL,
    pid INTEGER,
    harness_session_id TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (machine_id, role)
  )`,
  `CREATE TABLE IF NOT EXISTS read_model_handoffs (
    chatroom_id TEXT NOT NULL,
    pending_next_role TEXT,
    message_id TEXT,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (chatroom_id)
  )`,
  `CREATE TABLE IF NOT EXISTS enhancer_queue (
    job_id TEXT PRIMARY KEY,
    chatroom_id TEXT NOT NULL,
    machine_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_enhancer_queue_machine_status ON enhancer_queue(machine_id, status)`,
];
