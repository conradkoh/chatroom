import { describe, expect, it } from 'vitest';

import { listNativeTasksNeedingRevive, RecoveryCooldown } from './task-delivery-logic.js';

describe('task-delivery-logic', () => {
  it('revives a pending task when start cleared the backend PID', () => {
    const task = {
      taskId: 'task-1',
      chatroomId: 'room-1',
      status: 'pending',
      assignedTo: 'planner',
      updatedAt: 1,
      createdAt: 1,
      agentConfig: {
        role: 'planner',
        machineId: 'machine-1',
        agentHarness: 'cursor-sdk',
        workingDir: '/tmp',
        desiredState: 'running',
      },
      participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
    } as never;

    expect(
      listNativeTasksNeedingRevive(
        [task],
        {
          getSlot: () => undefined,
          isPidAlive: () => false,
        },
        10_000,
        new RecoveryCooldown(0)
      )
    ).toEqual([task]);
  });
});
