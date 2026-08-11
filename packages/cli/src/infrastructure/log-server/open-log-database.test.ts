import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { openLogDatabase } from './open-log-database.js';

describe('openLogDatabase', () => {
  it('enables WAL and supports two connections', () => {
    const path = join(tmpdir(), `logs-${randomUUID()}.sqlite`);
    const a = openLogDatabase(path);
    const b = openLogDatabase(path);
    expect(a.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' });
    a.exec("INSERT INTO log_entries(timestamp,level,source,message) VALUES(1,'info','x','hello')");
    expect(b.prepare('SELECT message FROM log_entries').get()).toMatchObject({ message: 'hello' });
    a.close();
    b.close();
  });
});
