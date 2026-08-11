import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendBatch, queryAfterId, queryHistory } from './log-store.js';
import { openLogDatabase } from './open-log-database.js';

describe('log store', () => {
  it('uses row ids for same-millisecond entries and clamps limits', () => {
    const db = openLogDatabase(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    appendBatch(db, [
      { timestamp: 1, level: 'info', source: 'harness:x', message: 'a' },
      { timestamp: 1, level: 'info', source: 'harness:x', message: 'b' },
    ]);
    const rows = queryAfterId(db, 0, 0);
    expect(rows.map((x) => x.message)).toEqual(['a']);
    expect(queryAfterId(db, rows[0].id, 100).map((x) => x.message)).toEqual(['b']);
    expect(queryHistory(db, undefined, 2000)).toHaveLength(2);
    db.close();
  });
});
