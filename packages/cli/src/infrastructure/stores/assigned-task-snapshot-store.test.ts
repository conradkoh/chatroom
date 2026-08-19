import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAssignedTaskSnapshots,
  listAssignedTaskSnapshots,
  listAssignedTaskSnapshotsForRole,
  hasAssignedTaskSnapshot,
  replaceAssignedTaskSnapshots,
  removeAssignedTaskSnapshot,
  upsertAssignedTaskSnapshot,
} from './assigned-task-snapshot-store.js';
import type { AssignedTaskSnapshotView } from '../../daemon/domain/entities/assigned-task.js';

const row = (role = 'Builder'): AssignedTaskSnapshotView => ({
  taskId: 'task',
  chatroomId: 'room',
  status: 'pending',
  assignedTo: undefined,
  updatedAt: 1,
  createdAt: 1,
  agentConfig: { role, machineId: 'm', agentHarness: 'x' },
});
describe('assigned task snapshot store', () => {
  beforeEach(() => clearAssignedTaskSnapshots());
  it('inserts and replaces case-insensitively', () => {
    upsertAssignedTaskSnapshot(row());
    upsertAssignedTaskSnapshot({ ...row('builder'), updatedAt: 2 });
    expect(listAssignedTaskSnapshots()).toHaveLength(1);
    expect(listAssignedTaskSnapshots()[0]?.updatedAt).toBe(2);
  });
  it('removes and ignores missing rows', () => {
    upsertAssignedTaskSnapshot(row());
    removeAssignedTaskSnapshot('task', 'BUILDER');
    removeAssignedTaskSnapshot('missing', 'x');
    expect(listAssignedTaskSnapshots()).toHaveLength(0);
  });
  it('copies replacements and listings', () => {
    const source = [row()];
    replaceAssignedTaskSnapshots(source);
    source.push(row('other'));
    expect(listAssignedTaskSnapshots()).toHaveLength(1);
    expect(listAssignedTaskSnapshots()[0]?.updatedAt).toBe(1);
    expect(listAssignedTaskSnapshots()).not.toBe(listAssignedTaskSnapshots());
  });
  it('filters rows by chatroom and role', () => {
    replaceAssignedTaskSnapshots([
      row('builder'),
      { ...row('builder'), taskId: 'two', chatroomId: 'other' },
      { ...row('reviewer'), taskId: 'three' },
    ]);
    expect(listAssignedTaskSnapshotsForRole('room', 'BUILDER')).toHaveLength(1);
  });
  it('tracks hydration state', () => {
    expect(hasAssignedTaskSnapshot()).toBe(false);
    replaceAssignedTaskSnapshots([]);
    expect(hasAssignedTaskSnapshot()).toBe(true);
    clearAssignedTaskSnapshots();
    upsertAssignedTaskSnapshot(row());
    expect(hasAssignedTaskSnapshot()).toBe(true);
  });
});
