import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendBatch,
  appendChatroomEvent,
  listLogDimensions,
  queryAfterId,
  queryEventStream,
  queryHistory,
} from './log-store.js';
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

  it('filters history by timestamp bounds', () => {
    const db = openLogDatabase(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    appendBatch(db, [
      { timestamp: 100, level: 'info', source: 'test', message: 'before' },
      { timestamp: 200, level: 'info', source: 'test', message: 'inside' },
      { timestamp: 300, level: 'info', source: 'test', message: 'after' },
    ]);
    expect(
      queryHistory(db, undefined, 100, undefined, undefined, undefined, undefined, 150, 250).map(
        (x) => x.message
      )
    ).toEqual(['inside']);
    db.close();
  });

  it('filters by metadata dimensions and lists distinct dimensions', () => {
    const db = openLogDatabase(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    appendBatch(db, [
      {
        timestamp: 1,
        level: 'info',
        source: 'harness:claude',
        message: 'one',
        metadata: { chatroomId: 'room-a', role: 'builder', harness: 'claude' },
      },
      {
        timestamp: 2,
        level: 'info',
        source: 'harness:codex',
        message: 'two',
        metadata: { chatroomId: 'room-b', role: 'planner', harness: 'codex' },
      },
      { timestamp: 3, level: 'info', source: 'harness:legacy', message: 'three' },
    ]);
    expect(
      queryHistory(db, undefined, 100, undefined, 'room-a', 'builder').map((x) => x.message)
    ).toEqual(['one']);
    expect(
      queryHistory(db, undefined, 100, undefined, undefined, undefined, 'legacy').map(
        (x) => x.message
      )
    ).toEqual(['three']);
    expect(listLogDimensions(db)).toEqual({
      chatroomIds: ['room-a', 'room-b'],
      roles: ['builder', 'planner'],
      harnesses: ['claude', 'codex', 'legacy'],
    });
    db.close();
  });

  it('stores migrated events in the dedicated event stream table', () => {
    const db = openLogDatabase(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    const firstEvent = appendChatroomEvent(db, {
      type: 'agent.exited',
      timestamp: 42,
      chatroomId: 'room-a',
      role: 'builder',
    });
    const secondEvent = appendChatroomEvent(db, {
      type: 'agent.exited',
      timestamp: 43,
      chatroomId: 'room-b',
      role: 'planner',
    });
    expect(firstEvent.id).toBeGreaterThan(0);
    expect(secondEvent.id).toBe(firstEvent.id + 1);

    expect(queryEventStream(db, { chatroomId: 'room-a' })).toMatchObject([
      {
        timestamp: 42,
        type: 'agent.exited',
        payload: { chatroomId: 'room-a', role: 'builder' },
      },
    ]);
    expect(queryEventStream(db, { chatroomId: 'room-a' })).toHaveLength(1);
    expect(queryHistory(db)).toEqual([]);
    db.close();
  });
});
