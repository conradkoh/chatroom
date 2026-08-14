import type {
  AssignedTaskPresenceSignal,
  AssignedTaskSignal,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { clearAssignedTaskSnapshots, listAssignedTaskSnapshots } from '../../../infrastructure/stores/assigned-task-snapshot-store.js';
import { handleInboundAssignedTaskEvent } from '../task-monitor-runtime.js';

const signal = {
  taskId: 'task_1', chatroomId: 'room_1', role: 'planner', status: 'pending', signalType: 'task',
  revisionKey: 'rev-1', machineId: 'machine-test', agentHarness: 'cursor-sdk', createdAt: 1_000,
} as AssignedTaskSignal;
const presence = {
  taskId: signal.taskId, chatroomId: signal.chatroomId, role: signal.role,
  lastSeenAt: 1_000, presenceUpdatedAt: 1_000, presenceKey: 'presence-1',
} as AssignedTaskPresenceSignal;

describe('assigned task signal race', () => {
  beforeEach(() => clearAssignedTaskSnapshots());
  afterEach(() => clearAssignedTaskSnapshots());

  test('bootstraps an empty store from a signal', () => {
    const reconcile = vi.fn();
    handleInboundAssignedTaskEvent({ type: 'assigned-task.signal', signal }, reconcile);
    expect(listAssignedTaskSnapshots()).toHaveLength(1);
    expect(reconcile).toHaveBeenCalledWith(
      [expect.objectContaining({ taskId: signal.taskId, status: 'pending' })],
      'signal'
    );
  });

  test('ignores presence without a base row', () => {
    const reconcile = vi.fn();
    handleInboundAssignedTaskEvent({ type: 'assigned-task.presence', presence }, reconcile);
    expect(listAssignedTaskSnapshots()).toHaveLength(0);
    expect(reconcile).not.toHaveBeenCalled();
  });
});
