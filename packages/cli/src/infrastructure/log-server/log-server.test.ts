import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createLogServer } from './log-server.js';
import { queryAfterId } from './log-store.js';

describe('log server', () => {
  it('flushes buffered writes', () => {
    const s = createLogServer(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    s.write({ timestamp: 1, level: 'info', source: 'harness:x', message: 'hello' });
    s.flush();
    expect(queryAfterId(s.db)).toHaveLength(1);
    s.close();
  });

  it('writeChatroomLog persists structured events to chatroom_logs', () => {
    const s = createLogServer(join(tmpdir(), `logs-${randomUUID()}.sqlite`));
    s.writeChatroomLog({
      chatroomId: 'room-1',
      timestamp: 1000,
      type: 'agent.started',
      role: 'builder',
      machineId: 'machine-1',
      payload: { pid: 42 },
    });
    s.flush();
    const row = s.db.prepare('SELECT type, payload_json FROM chatroom_logs').get() as {
      type: string;
      payload_json: string;
    };
    expect(row.type).toBe('agent.started');
    expect(JSON.parse(row.payload_json)).toEqual({ pid: 42 });
    s.close();
  });
});
