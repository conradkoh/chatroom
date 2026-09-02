import { describe, expect, it } from 'vitest';

import { MachineTaskSnapshotState } from './task-snapshot-state.js';

function row(taskId: string, role = 'builder') {
  return {
    taskId: taskId as never,
    chatroomId: 'room-1' as never,
    status: 'pending' as const,
    assignedTo: role,
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role, machineId: 'machine-1', agentHarness: 'cursor-sdk' },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
  };
}

describe('MachineTaskSnapshotState', () => {
  it('is uninitialized until the bootstrap snapshot is replaced', () => {
    const state = new MachineTaskSnapshotState();

    expect(state.isInitialized()).toBe(false);
    state.replace([]);
    expect(state.isInitialized()).toBe(true);
  });

  it('replaces bootstrap state and filters by role', () => {
    const state = new MachineTaskSnapshotState();
    state.replace([row('task-1'), row('task-2', 'planner')]);

    expect(state.listForRole('room-1', 'BUILDER')).toHaveLength(1);
    expect(state.listForRole('room-1', 'planner')[0]?.taskId).toBe('task-2');
    expect(state.getForRole('room-1', 'builder', 'task-1')?.taskId).toBe('task-1');
    expect(state.getForRole('other-room', 'builder', 'task-1')).toBeNull();
  });

  it('removes tasks whose signal no longer has an active snapshot', () => {
    const state = new MachineTaskSnapshotState();
    state.replace([row('task-1')]);

    state.applySignalPage(
      [
        {
          taskId: 'task-1' as never,
          chatroomId: 'room-1' as never,
          targetRole: 'builder',
          taskStatus: 'completed',
          signalKey: '0000000000000001:task-1',
          taskUpdatedAt: 1,
        },
      ],
      []
    );

    expect(state.listForRole('room-1', 'builder')).toHaveLength(0);
  });
});
