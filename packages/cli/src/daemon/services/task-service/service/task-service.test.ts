import { describe, expect, test, vi } from 'vitest';

import { createTaskService } from './task-service.js';
import { api } from '../../../../api.js';

function backendRow() {
  return {
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending' as const,
    assignedTo: 'user-1',
    updatedAt: 1000,
    createdAt: 900,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      model: 'gpt-4',
      workingDir: '/tmp/ws',
    },
    taskContent: 'Do the thing',
  };
}

describe('TaskService.loadAssignedTaskForAction', () => {
  test('returns null for a wrong-room row and the mapped task for the requested room', async () => {
    const query = vi.fn(async () => backendRow());
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      backend: { mutation: vi.fn(async () => undefined), query },
      agentProcessService: {
        getSlot: vi.fn(),
        resumeTurnForSlot: vi.fn(),
        runSerializedForAgent: vi.fn(),
      } as never,
      lifecycleOutbox: { enqueue: vi.fn(async () => undefined) },
    } as never);

    await expect(
      service.loadAssignedTaskForAction({
        chatroomId: 'different-room',
        role: 'builder',
        taskId: 'task-1',
      })
    ).resolves.toBeNull();

    await expect(
      service.loadAssignedTaskForAction({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      })
    ).resolves.toMatchObject({
      taskId: 'task-1',
      chatroomId: 'room-1',
      taskContent: 'Do the thing',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(api.machines.getAssignedTaskForAction, {
      sessionId: 'session-1',
      machineId: 'machine-1',
      taskId: 'task-1',
      role: 'builder',
    });
  });
});
