import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendChatroomLogBatch,
  listChatroomLogTypes,
  queryChatroomLogHistory,
  queryChatroomLogsAfterId,
} from './chatroom-log-store.js';
import { openLogDatabase } from './open-log-database.js';

function db() {
  return openLogDatabase(join(tmpdir(), `chatroom-logs-${randomUUID()}.sqlite`));
}
describe('chatroom-log-store', () => {
  it('appends and queries ordered entries with filters and pagination', () => {
    const database = db();
    appendChatroomLogBatch(database, [
      {
        chatroomId: 'a',
        timestamp: 10,
        type: 'agent.started',
        machineId: 'm1',
        role: 'builder',
        payload: { n: 1 },
      },
      {
        chatroomId: 'a',
        timestamp: 20,
        type: 'task.activated',
        role: 'planner',
        payload: { n: 2 },
      },
      { chatroomId: 'b', timestamp: 30, type: 'agent.started', payload: { n: 3 } },
    ]);
    const history = queryChatroomLogHistory(database, { chatroomId: 'a' });
    expect(history.map((entry) => entry.timestamp)).toEqual([10, 20]);
    expect(history[0]?.machineId).toBe('m1');
    expect(history[1]?.machineId).toBeUndefined();
    expect(
      queryChatroomLogHistory(database, {
        chatroomId: 'a',
        fromTimestamp: 15,
        toTimestamp: 20,
        role: 'planner',
      })
    ).toHaveLength(1);
    expect(
      queryChatroomLogHistory(database, { chatroomId: 'a', type: 'agent.started', machineId: 'm1' })
    ).toHaveLength(1);
    expect(
      queryChatroomLogsAfterId(database, { chatroomId: 'a', afterId: history[0]!.id })
    ).toHaveLength(1);
    expect(listChatroomLogTypes(database, 'a')).toEqual(['agent.started', 'task.activated']);
    database.close();
  });
});
