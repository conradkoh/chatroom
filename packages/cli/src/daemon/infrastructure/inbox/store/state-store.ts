import type { DatabaseSync } from 'node:sqlite';

export interface InboxStateKey {
  /** Logical inbox family, e.g. `task` or a future inbox type. */
  inboxType: string;
  /** Instance scope, e.g. a chatroom ID or another stable owner key. */
  scopeKey: string;
}

export interface InboxStateRecord<TState = unknown> extends InboxStateKey {
  state: TState;
  createdAt: number;
  updatedAt: number;
}

export interface InboxStateQuery {
  inboxType?: string | undefined;
  scopeKey?: string | undefined;
  scopePrefix?: string | undefined;
  updatedAfter?: number | undefined;
  limit?: number | undefined;
}

type InboxStateRow = {
  inbox_type: string;
  scope_key: string;
  state_json: string;
  created_at: number;
  updated_at: number;
};

const MAX_QUERY_LIMIT = 1_000;

function assertKeyPart(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} cannot be empty`);
  }
}

function encodeState(state: unknown): string {
  const encoded = JSON.stringify(state);
  if (encoded === undefined) {
    throw new Error('Inbox state must be JSON serializable');
  }
  return encoded;
}

function decodeRow<TState>(row: InboxStateRow): InboxStateRecord<TState> {
  return {
    inboxType: row.inbox_type,
    scopeKey: row.scope_key,
    state: JSON.parse(row.state_json) as TState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildQuery(options: InboxStateQuery): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (options.inboxType !== undefined) {
    clauses.push('inbox_type = ?');
    params.push(options.inboxType);
  }
  if (options.scopeKey !== undefined) {
    clauses.push('scope_key = ?');
    params.push(options.scopeKey);
  }
  if (options.scopePrefix !== undefined) {
    clauses.push('scope_key LIKE ?');
    params.push(`${options.scopePrefix}%`);
  }
  if (options.updatedAfter !== undefined) {
    clauses.push('updated_at > ?');
    params.push(options.updatedAfter);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(options.limit ?? MAX_QUERY_LIMIT, 1), MAX_QUERY_LIMIT);

  return {
    sql: `SELECT inbox_type, scope_key, state_json, created_at, updated_at
          FROM inbox_state ${where}
          ORDER BY updated_at DESC, inbox_type ASC, scope_key ASC
          LIMIT ?`,
    params: [...params, limit],
  };
}

export function getInboxState<TState>(
  db: DatabaseSync,
  key: InboxStateKey
): InboxStateRecord<TState> | null {
  assertKeyPart(key.inboxType, 'inboxType');
  assertKeyPart(key.scopeKey, 'scopeKey');

  const row = db
    .prepare(
      `SELECT inbox_type, scope_key, state_json, created_at, updated_at
       FROM inbox_state
       WHERE inbox_type = ? AND scope_key = ?`
    )
    .get(key.inboxType, key.scopeKey) as InboxStateRow | undefined;

  return row ? decodeRow<TState>(row) : null;
}

export function saveInboxState<TState>(
  db: DatabaseSync,
  key: InboxStateKey,
  state: TState,
  updatedAt = Date.now()
): void {
  assertKeyPart(key.inboxType, 'inboxType');
  assertKeyPart(key.scopeKey, 'scopeKey');
  const stateJson = encodeState(state);

  db.prepare(
    `INSERT INTO inbox_state(inbox_type, scope_key, state_json, created_at, updated_at)
     VALUES(?, ?, ?, ?, ?)
     ON CONFLICT(inbox_type, scope_key) DO UPDATE SET
       state_json = excluded.state_json,
       updated_at = excluded.updated_at`
  ).run(key.inboxType, key.scopeKey, stateJson, updatedAt, updatedAt);
}

export function queryInboxState<TState = unknown>(
  db: DatabaseSync,
  options: InboxStateQuery = {}
): InboxStateRecord<TState>[] {
  const { sql, params } = buildQuery(options);
  return (db.prepare(sql).all(...params) as InboxStateRow[]).map((row) => decodeRow<TState>(row));
}

export function deleteInboxState(db: DatabaseSync, key: InboxStateKey): void {
  assertKeyPart(key.inboxType, 'inboxType');
  assertKeyPart(key.scopeKey, 'scopeKey');
  db.prepare('DELETE FROM inbox_state WHERE inbox_type = ? AND scope_key = ?').run(
    key.inboxType,
    key.scopeKey
  );
}
