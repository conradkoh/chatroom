import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearAssignedTaskSnapshots,
  listAssignedTaskSnapshots,
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
});
