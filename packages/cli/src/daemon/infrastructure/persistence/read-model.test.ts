import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { appendOutboundEvent } from './event-store.js';
import { openDatabase } from './open-database.js';
import { listHarnessStreamLines } from './read-model.js';

function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'v2-read-model-'));
  return join(dir, 'events.sqlite');
}

function harnessStream(
  harness: string,
  line: string,
  timestamp: number
): {
  type: 'harness.stream';
  harness: string;
  stream: 'stdout';
  line: string;
  timestamp: number;
} {
  return { type: 'harness.stream', harness, stream: 'stdout', line, timestamp };
}

describe('listHarnessStreamLines', () => {
  it('returns harness.stream events in chronological order', () => {
    const db = openDatabase(tempDbPath());
    try {
      appendOutboundEvent(db, harnessStream('h1', 'first', 100));
      appendOutboundEvent(db, harnessStream('h1', 'second', 200));
      appendOutboundEvent(db, harnessStream('h2', 'other', 300));

      const lines = listHarnessStreamLines(db);
      expect(lines).toEqual([
        harnessStream('h1', 'first', 100),
        harnessStream('h1', 'second', 200),
        harnessStream('h2', 'other', 300),
      ]);
    } finally {
      db.close();
    }
  });

  it('filters by harness when provided', () => {
    const db = openDatabase(tempDbPath());
    try {
      appendOutboundEvent(db, harnessStream('h1', 'a', 1));
      appendOutboundEvent(db, harnessStream('h2', 'b', 2));

      expect(listHarnessStreamLines(db, { harness: 'h1' })).toEqual([harnessStream('h1', 'a', 1)]);
    } finally {
      db.close();
    }
  });
});
