import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { createTaskHandoffRepository } from './task-handoff-repository.js';

describe('TaskHandoffRepository', () => {
  test('upserts and reads the latest handoff per chatroom and role', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'task-handoffs-')), 'handoffs.sqlite');
    const repository = createTaskHandoffRepository(path);
    await repository.record({
      chatroomId: 'room',
      role: 'Planner',
      taskIds: ['task-1'],
      targetRole: 'builder',
      handedOffAt: 1,
    });
    await repository.record({
      chatroomId: 'room',
      role: 'planner',
      taskIds: ['task-2', 'task-3'],
      nextTaskId: 'task-4',
      targetRole: 'builder',
      handedOffAt: 2,
    });

    await expect(repository.getLatest('room', 'PLANNER')).resolves.toEqual({
      chatroomId: 'room',
      role: 'planner',
      taskIds: ['task-2', 'task-3'],
      nextTaskId: 'task-4',
      targetRole: 'builder',
      handedOffAt: 2,
    });
    repository.close();
  });

  test('reads a record from a new repository instance', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'task-handoffs-')), 'handoffs.sqlite');
    const first = createTaskHandoffRepository(path);
    await first.record({
      chatroomId: 'room',
      role: 'builder',
      taskIds: ['task-1'],
      targetRole: 'user',
      handedOffAt: 42,
    });
    first.close();

    const second = createTaskHandoffRepository(path);
    await expect(second.getLatest('room', 'builder')).resolves.toMatchObject({
      taskIds: ['task-1'],
      handedOffAt: 42,
    });
    second.close();
  });
});
