/**
 * Static guard: every migration `table` must be defined in schema.ts.
 *
 * A migration whose table is missing from the schema makes the backend reject its
 * paginated read (`Index <table>.by_creation_time not found`), which stops
 * `migrations:runAll` and blocks every later migration. convex-test cannot reproduce
 * that backend error, so this spec checks the table names statically.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

import schema from './schema';

const migrationsSource = readFileSync(
  fileURLToPath(new URL('./migrations.ts', import.meta.url)),
  'utf8'
);

const schemaTables = new Set(Object.keys(schema.tables));

describe('migrations: table references', () => {
  test('every migration table is defined in schema.ts', () => {
    const referenced = [...migrationsSource.matchAll(/table:\s*'([^']+)'/g)].flatMap((m) =>
      m[1] ? [m[1]] : []
    );
    expect(referenced).toContain('chatroom_tasks');

    const missing = [...new Set(referenced)].filter((name) => !schemaTables.has(name));
    expect(missing).toEqual([]);
  });

  test('no migration casts a table name to never', () => {
    expect(migrationsSource).not.toMatch(/table:\s*'[^']+'\s+as\s+never/);
  });
});
