import type { AssignedTaskSignal } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { beforeEach, describe, expect, it } from 'vitest';

import { createTaskMonitorSnapshot } from './task-monitor/task-monitor-snapshot.js';
import { handleInboundAssignedTaskEvent } from './task-monitor-runtime.js';
import {
  clearAssignedTaskSnapshots,
  listAssignedTaskSnapshots,
} from '../../infrastructure/stores/assigned-task-snapshot-store.js';

const signal: AssignedTaskSignal = {
  taskId: 'task_1' as AssignedTaskSignal['taskId'],
  chatroomId: 'room_1' as AssignedTaskSignal['chatroomId'],
  role: 'builder',
  status: 'pending',
  signalType: 'task',
  revisionKey: 'revision_1',
  machineId: 'machine_1',
  agentHarness: 'opencode',
  workingDir: '/workspace',
  createdAt: 1_000,
};

describe('task monitor inbound event handling', () => {
  beforeEach(() => {
    clearAssignedTaskSnapshots();
  });

  it('merges an incremental signal into the local store without a full snapshot update', () => {
    const snapshot = createTaskMonitorSnapshot();
    const passes: unknown[] = [];

    handleInboundAssignedTaskEvent(
      { type: 'assigned-task.signal', taskId: signal.taskId, role: signal.role, signal },
      (tasks, pass) => passes.push({ tasks, pass }),
      snapshot
    );

    expect(listAssignedTaskSnapshots()).toHaveLength(1);
    expect(listAssignedTaskSnapshots()[0]?.taskId).toBe(signal.taskId);
    expect(passes).toHaveLength(1);
    expect(passes[0]).toMatchObject({ pass: 'signal' });
  });
});
