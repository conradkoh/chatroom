import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { SqliteEventStore } from './sqlite-event-store';
import type { AppendEventInput } from './types';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'event-store-'));
  dirs.push(dir);
  return dir;
}

function makeInput(overrides: Partial<AppendEventInput> = {}): AppendEventInput {
  return {
    chatroomId: 'room-1',
    machineId: 'machine-1',
    type: 'agent.started',
    timestamp: 1000,
    payload: JSON.stringify({ role: 'builder' }),
    ...overrides,
  };
}

describe('SqliteEventStore', () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('appends and lists newest-first', () => {
    const store = new SqliteEventStore(join(tempDir(), 'events.sqlite'));
    store.append(makeInput({ timestamp: 1000 }));
    store.append(makeInput({ timestamp: 3000, type: 'agent.exited' }));
    store.append(makeInput({ timestamp: 2000, type: 'agent.startFailed' }));

    const result = store.listByChatroom({ chatroomId: 'room-1' });

    expect(result.isDone).toBe(true);
    expect(result.continueCursor).toBeNull();
    expect(result.page.map((e) => e.type)).toEqual([
      'agent.exited',
      'agent.startFailed',
      'agent.started',
    ]);
    expect(result.page[0]!.timestamp).toBe(3000);
    expect(result.page[1]!.timestamp).toBe(2000);
    expect(result.page[2]!.timestamp).toBe(1000);
    store.close();
  });

  test('paginates with keyset cursor', () => {
    const store = new SqliteEventStore(join(tempDir(), 'events.sqlite'));
    for (let i = 0; i < 5; i++) {
      store.append(makeInput({ timestamp: i + 1 }));
    }

    const first = store.listByChatroom({ chatroomId: 'room-1', limit: 2 });
    expect(first.page).toHaveLength(2);
    expect(first.isDone).toBe(false);
    expect(first.continueCursor).not.toBeNull();

    const second = store.listByChatroom({
      chatroomId: 'room-1',
      limit: 2,
      cursor: first.continueCursor ?? undefined,
    });
    expect(second.page).toHaveLength(2);
    expect(second.isDone).toBe(false);

    const third = store.listByChatroom({
      chatroomId: 'room-1',
      limit: 2,
      cursor: second.continueCursor ?? undefined,
    });
    expect(third.page).toHaveLength(1);
    expect(third.isDone).toBe(true);

    const allIds = [...first.page, ...second.page, ...third.page].map((e) => e.id);
    expect(new Set(allIds).size).toBe(5);
    store.close();
  });

  test('scopes listings to a chatroom', () => {
    const store = new SqliteEventStore(join(tempDir(), 'events.sqlite'));
    store.append(makeInput({ chatroomId: 'room-a' }));
    store.append(makeInput({ chatroomId: 'room-b' }));

    const result = store.listByChatroom({ chatroomId: 'room-a' });
    expect(result.page).toHaveLength(1);
    expect(result.page[0]!.chatroomId).toBe('room-a');
    store.close();
  });

  test('read-only open of a missing file behaves as an empty store', () => {
    const store = new SqliteEventStore(join(tempDir(), 'missing.sqlite'), { readOnly: true });
    const result = store.listByChatroom({ chatroomId: 'room-1' });
    expect(result.page).toEqual([]);
    expect(result.isDone).toBe(true);
    store.close();
  });

  test('read-only open can read a store written earlier', () => {
    const dir = tempDir();
    const file = join(dir, 'events.sqlite');
    const writer = new SqliteEventStore(file);
    writer.append(makeInput({ timestamp: 1000 }));
    writer.append(makeInput({ timestamp: 2000, type: 'agent.exited' }));
    writer.close();

    const reader = new SqliteEventStore(file, { readOnly: true });
    const result = reader.listByChatroom({ chatroomId: 'room-1' });
    expect(result.page.map((e) => e.type)).toEqual(['agent.exited', 'agent.started']);
    reader.close();
  });
});
