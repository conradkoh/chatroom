import type { AssignedTaskSnapshotView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test, beforeEach } from 'vitest';

import {
  clearAssignedTaskSnapshots,
  hasAssignedTaskSnapshot,
  listAssignedTaskSnapshots,
  listAssignedTaskSnapshotsForRole,
  replaceAssignedTaskSnapshots,
} from './assigned-task-snapshot-store.js';

function makeRow(overrides: Partial<AssignedTaskSnapshotView> = {}): AssignedTaskSnapshotView {
  return {
    taskId: 'task_1' as never,
    chatroomId: 'room_1' as never,
    status: 'pending' as const,
    assignedTo: 'builder',
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role: 'builder',
      machineId: 'm',
      agentHarness: 'cursor-sdk',
      workingDir: '/test',
      spawnedAgentPid: 42_424,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  } as AssignedTaskSnapshotView;
}

describe('assigned-task-snapshot-store', () => {
  beforeEach(() => {
    clearAssignedTaskSnapshots();
  });

  test('initially hasSnapshot is false', () => {
    expect(hasAssignedTaskSnapshot()).toBe(false);
  });

  test('replace sets hasSnapshot and stores rows', () => {
    const row = makeRow();
    replaceAssignedTaskSnapshots([row]);
    expect(hasAssignedTaskSnapshot()).toBe(true);
    expect(listAssignedTaskSnapshots()).toHaveLength(1);
  });

  test('list returns a copy (mutating the returned array must not corrupt store)', () => {
    const row = makeRow();
    replaceAssignedTaskSnapshots([row]);
    const copy = listAssignedTaskSnapshots();
    copy.push(makeRow({ taskId: 'task_2' as never }));
    expect(listAssignedTaskSnapshots()).toHaveLength(1);
  });

  test('listAssignedTaskSnapshotsForRole filters by chatroomId and role (case-insensitive)', () => {
    const row1 = makeRow({
      taskId: 'task_1' as never,
      chatroomId: 'room_1' as never,
      agentConfig: { ...makeRow().agentConfig, role: 'builder' },
    });
    const row2 = makeRow({
      taskId: 'task_2' as never,
      chatroomId: 'room_1' as never,
      agentConfig: { ...makeRow().agentConfig, role: 'planner' },
    });
    const row3 = makeRow({
      taskId: 'task_3' as never,
      chatroomId: 'room_2' as never,
      agentConfig: { ...makeRow().agentConfig, role: 'builder' },
    });
    replaceAssignedTaskSnapshots([row1, row2, row3]);

    const builderRoom1 = listAssignedTaskSnapshotsForRole('room_1', 'builder');
    expect(builderRoom1).toHaveLength(1);
    expect(builderRoom1[0].taskId).toBe('task_1');

    const plannerRoom1 = listAssignedTaskSnapshotsForRole('room_1', 'planner');
    expect(plannerRoom1).toHaveLength(1);
    expect(plannerRoom1[0].taskId).toBe('task_2');

    const builderRoom2 = listAssignedTaskSnapshotsForRole('room_2', 'builder');
    expect(builderRoom2).toHaveLength(1);
    expect(builderRoom2[0].taskId).toBe('task_3');

    const empty = listAssignedTaskSnapshotsForRole('room_3', 'builder');
    expect(empty).toHaveLength(0);
  });

  test('case-insensitive role matching', () => {
    const row = makeRow({
      chatroomId: 'room_1' as never,
      agentConfig: { ...makeRow().agentConfig, role: 'Builder' },
    });
    replaceAssignedTaskSnapshots([row]);

    const result = listAssignedTaskSnapshotsForRole('room_1', 'BUILDER');
    expect(result).toHaveLength(1);
  });

  test('clear resets store', () => {
    replaceAssignedTaskSnapshots([makeRow()]);
    expect(hasAssignedTaskSnapshot()).toBe(true);
    clearAssignedTaskSnapshots();
    expect(hasAssignedTaskSnapshot()).toBe(false);
    expect(listAssignedTaskSnapshots()).toHaveLength(0);
  });
});
