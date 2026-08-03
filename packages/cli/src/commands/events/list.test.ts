import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { listEvents } from './list.js';
import { SqliteEventStore } from '../../infrastructure/event-store/index.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'events-list-'));
  dirs.push(dir);
  return dir;
}

describe('listEvents', () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('prints seeded events newest-first as JSON lines', async () => {
    const file = join(tempDir(), 'events.sqlite');
    const store = new SqliteEventStore(file);
    store.append({
      chatroomId: 'room-1',
      machineId: 'machine-1',
      type: 'agent.started',
      timestamp: 1000,
      payload: '{"role":"builder"}',
    });
    store.append({
      chatroomId: 'room-1',
      machineId: 'machine-1',
      type: 'agent.exited',
      timestamp: 3000,
      payload: '{}',
    });
    store.append({
      chatroomId: 'room-2',
      machineId: 'machine-1',
      type: 'agent.started',
      timestamp: 2000,
      payload: '{}',
    });
    store.close();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listEvents({ machineId: 'machine-1', chatroomId: 'room-1', limit: 10 }, file);

    const lines = logSpy.mock.calls.map((call) => JSON.parse(call[0] as string));
    logSpy.mockRestore();

    expect(lines.map((line) => line.type)).toEqual(['agent.exited', 'agent.started']);
    expect(lines.every((line) => line.chatroomId === 'room-1')).toBe(true);
  });

  test('prints nothing when the store file does not exist', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await listEvents(
      { machineId: 'machine-1', chatroomId: 'room-1' },
      join(tempDir(), 'missing.sqlite')
    );

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
