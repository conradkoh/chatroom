import { describe, expect, it } from 'vitest';

import { shouldRecordTaskStateChange } from './machine-assigned-task-change-log';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';

function makeSnapshotDoc(
  overrides: Partial<Doc<'chatroom_machineAssignedTaskSnapshots'>> = {}
): Doc<'chatroom_machineAssignedTaskSnapshots'> {
  const now = 1_700_000_000_000;
  return {
    _id: 'snapshot_1' as Id<'chatroom_machineAssignedTaskSnapshots'>,
    _creationTime: now,
    machineId: 'machine-1',
    taskId: 'task_1' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    role: 'builder',
    taskStatus: 'pending',
    taskAssignedTo: 'builder',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'opencode',
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-key',
    revisionKey: 'revision-key',
    signalUpdatedAt: now,
    ...overrides,
  };
}

describe('shouldRecordTaskStateChange', () => {
  it('records inserts', () =>
    expect(shouldRecordTaskStateChange(null, makeSnapshotDoc())).toBe(true));
  it('records action and status changes', () => {
    const row = makeSnapshotDoc();
    expect(shouldRecordTaskStateChange(row, { ...row, lastSeenAction: 'joined' })).toBe(true);
    expect(shouldRecordTaskStateChange(row, { ...row, taskStatus: 'in_progress' })).toBe(true);
  });
  it('ignores presence-only changes', () => {
    const row = makeSnapshotDoc();
    expect(
      shouldRecordTaskStateChange(row, {
        ...row,
        lastSeenAt: 2,
        presenceUpdatedAt: 2,
        presenceKey: 'new',
      })
    ).toBe(false);
  });
  it('ignores identical rows', () => {
    const row = makeSnapshotDoc();
    expect(shouldRecordTaskStateChange(row, { ...row })).toBe(false);
  });
});
