import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { EVENT_STORE_DDL } from './schema';
import type {
  AppendEventInput,
  EventStore,
  ListByChatroomArgs,
  ListByChatroomResult,
  SqliteEventStoreOptions,
  StoredEvent,
} from './types';

interface EventRow {
  id: string;
  chatroom_id: string;
  machine_id: string;
  type: string;
  timestamp: number;
  payload: string;
}

function encodeCursor(last: StoredEvent): string {
  return Buffer.from(JSON.stringify({ timestamp: last.timestamp, id: last.id }), 'utf8').toString(
    'base64'
  );
}

function decodeCursor(cursor: string): { timestamp: number; id: string } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
  return { timestamp: Number(parsed.timestamp), id: String(parsed.id) };
}

function rowToEvent(row: EventRow): StoredEvent {
  return {
    id: row.id,
    chatroomId: row.chatroom_id,
    machineId: row.machine_id,
    type: row.type,
    timestamp: row.timestamp,
    payload: row.payload,
  };
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? 20, 1), 200);
}

function buildPageResult(page: StoredEvent[], limit: number): ListByChatroomResult {
  const isDone = page.length < limit;
  const continueCursor = isDone || page.length === 0 ? null : encodeCursor(page[page.length - 1]);
  return { page, continueCursor, isDone };
}

/**
 * SQLite-backed local event store. Default DELETE journal mode (no WAL) so the
 * CLI reader can open the store read-only while the daemon has it open.
 */
export class SqliteEventStore implements EventStore {
  private db: DatabaseSync | null;

  constructor(
    private readonly filePath: string,
    private readonly options: SqliteEventStoreOptions = {}
  ) {
    this.db = this.openDatabase(filePath, options.readOnly ?? false);
  }

  append(input: AppendEventInput): string {
    const id = randomUUID();
    if (!this.db) return id; // read-only empty store — no-op
    this.db
      .prepare(
        `INSERT INTO events (id, chatroom_id, machine_id, type, timestamp, payload)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.chatroomId, input.machineId, input.type, input.timestamp, input.payload);
    return id;
  }

  listByChatroom(args: ListByChatroomArgs): ListByChatroomResult {
    if (!this.db) return { page: [], continueCursor: null, isDone: true };
    const limit = clampLimit(args.limit);
    const rows = this.queryPage(args, limit);
    return buildPageResult(rows.map(rowToEvent), limit);
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  private openDatabase(filePath: string, readOnly: boolean): DatabaseSync | null {
    if (readOnly) {
      // Missing file under read-only open throws in node:sqlite — treat as an
      // empty store so the CLI reader prints nothing and exits 0.
      if (!existsSync(filePath)) return null;
      return new DatabaseSync(filePath, { readOnly: true });
    }
    mkdirSync(dirname(filePath), { recursive: true });
    const db = new DatabaseSync(filePath);
    // DDL includes an INSERT (schema_version) — never run it on a read-only DB.
    for (const ddl of EVENT_STORE_DDL) {
      db.exec(ddl);
    }
    return db;
  }

  private queryPage(args: ListByChatroomArgs, limit: number): EventRow[] {
    const params: (string | number)[] = [args.chatroomId];
    let cursorClause = '';
    if (args.cursor) {
      const cursor = decodeCursor(args.cursor);
      cursorClause = 'AND (timestamp < ? OR (timestamp = ? AND id < ?))';
      params.push(cursor.timestamp, cursor.timestamp, cursor.id);
    }
    params.push(limit);
    return this.db
      ?.prepare(
        `SELECT id, chatroom_id, machine_id, type, timestamp, payload
         FROM events
         WHERE chatroom_id = ? ${cursorClause}
         ORDER BY timestamp DESC, id DESC
         LIMIT ?`
      )
      .all(...params) as unknown as EventRow[];
  }
}
