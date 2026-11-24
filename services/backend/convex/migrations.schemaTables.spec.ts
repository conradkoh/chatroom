/**
 * Static guard for migration table references.
 *
 * Every migration's `table` must be a single-quoted literal naming a table in schema.ts, and no
 * `table` value may be cast. A migration whose table is missing from the schema makes the backend
 * reject its paginated read (`Index <table>.by_creation_time not found`), which stops
 * `migrations:runAll` and blocks every later migration. convex-test cannot reproduce that backend
 * error, so this spec checks the source text statically.
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

const definitionCount = (migrationsSource.match(/migrations\.define\(/g) ?? []).length;
const tableKeyCount = (migrationsSource.match(/\btable\s*:/g) ?? []).length;
const literalTables = [...migrationsSource.matchAll(/\btable\s*:\s*'([^']+)'/g)].flatMap((m) =>
  m[1] ? [m[1]] : []
);
const tableCasts = migrationsSource.match(/\btable\s*:[^,\n]*\bas\b/g) ?? [];

describe('migrations: table references', () => {
  test('every migration names its table with a single-quoted literal', () => {
    // A double-quoted name, template literal, or variable is not counted as a literal,
    // so the counts diverge and this fails.
    expect(definitionCount).toBeGreaterThan(0);
    expect(tableKeyCount).toBe(definitionCount);
    expect(literalTables).toHaveLength(definitionCount);
  });

  test('every migration table is defined in schema.ts', () => {
    const missing = [...new Set(literalTables)].filter((name) => !schemaTables.has(name));
    expect(missing).toEqual([]);
  });

  test('no migration casts a table value', () => {
    expect(tableCasts).toEqual([]);
  });
});
