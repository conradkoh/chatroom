import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openDatabase } from './open-database.js';
import { SCHEMA_VERSION } from './schema.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-schema-'));
  return join(dir, 'events.sqlite');
}

function tableNames(db: ReturnType<typeof openDatabase>): string[] {
  const rows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

describe('schema', () => {
  it('is at version 4 with read model tables', () => {
    const db = openDatabase(tempDbPath());
    try {
      expect(SCHEMA_VERSION).toBe(5);
      const names = tableNames(db);
      expect(names).toEqual(
        expect.arrayContaining([
          'read_model_tasks',
          'read_model_participants',
          'read_model_agents',
          'read_model_handoffs',
          'enhancer_queue',
        ])
      );
    } finally {
      db.close();
    }
  });

  it('migrations are idempotent across reopen', () => {
    const path = tempDbPath();
    const first = openDatabase(path);
    first.close();

    expect(() => openDatabase(path)).not.toThrow();
    const db = openDatabase(path);
    try {
      const names = tableNames(db);
      expect(names.filter((n) => n === 'read_model_tasks')).toHaveLength(1);
    } finally {
      db.close();
    }
  });
});
