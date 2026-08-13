import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema.js';

export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  for (const sql of MIGRATIONS) {
    db.exec(sql);
  }
  const taskContentColumn = db
    .prepare(`SELECT 1 FROM pragma_table_info('read_model_tasks') WHERE name = 'task_content'`)
    .get();
  if (!taskContentColumn) {
    db.exec('ALTER TABLE read_model_tasks ADD COLUMN task_content TEXT');
  }
  db.prepare(
    `INSERT INTO schema_meta(key, value) VALUES('version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(SCHEMA_VERSION));
  return db;
}
