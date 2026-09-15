import { describe, expect, test, vi } from 'vitest';

import { createConvexNativeTaskDeliveryGateway } from './convex-native-task-delivery-gateway.js';
import { api } from '../../../../../api.js';

function backendRow() {
  return {
    taskId: 'task_1',
    chatroomId: 'room_1',
    status: 'pending' as const,
    assignedTo: 'user_1',
    updatedAt: 1000,
    createdAt: 900,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      model: 'gpt-4',
      workingDir: '/tmp/ws',
    },
    taskContent: 'Do the thing',
  };
}

describe('createConvexNativeTaskDeliveryGateway.loadAssignedTaskForAction', () => {
  test('queries the exact-task endpoint and maps to the daemon AssignedTaskWithContent shape', async () => {
    const query = vi.fn(async () => backendRow());
    const gateway = createConvexNativeTaskDeliveryGateway({
      mutation: vi.fn(async () => undefined),
      query,
    });

    const result = await gateway.loadAssignedTaskForAction({
      sessionId: 'session_1',
      machineId: 'machine_1',
      taskId: 'task_1',
      role: 'builder',
    });

    expect(query).toHaveBeenCalledWith(api.machines.getAssignedTaskForAction, {
      sessionId: 'session_1',
      machineId: 'machine_1',
      taskId: 'task_1',
      role: 'builder',
    });
    expect(result?.taskId).toBe('task_1');
    expect(result?.chatroomId).toBe('room_1');
    expect(result?.taskContent).toBe('Do the thing');
    expect(result?.agentConfig.role).toBe('builder');
  });

  test('returns null when the backend has no row', async () => {
    const query = vi.fn(async () => null);
    const gateway = createConvexNativeTaskDeliveryGateway({
      mutation: vi.fn(async () => undefined),
      query,
    });

    const result = await gateway.loadAssignedTaskForAction({
      sessionId: 'session_1',
      machineId: 'machine_1',
      taskId: 'missing',
      role: 'builder',
    });

    expect(result).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('createConvexNativeTaskDeliveryGateway.listTaskInboxEventsForChatroom', () => {
  test('queries the chatroom history endpoint and flattens each row', async () => {
    const query = vi.fn(async () => [
      {
        _id: 'event_1',
        eventType: 'task_assigned',
        status: 'processed',
        role: 'planner',
        taskId: 'task_1',
        createdAt: 100,
        processedAt: 500,
        task: { status: 'pending' },
      },
      {
        _id: 'event_2',
        eventType: 'task_updated',
        status: 'pending',
        role: 'planner',
        taskId: 'task_1',
        createdAt: 90,
        task: { status: 'pending' },
      },
    ]);
    const gateway = createConvexNativeTaskDeliveryGateway({
      mutation: vi.fn(async () => undefined),
      query,
    });

    const result = await gateway.listTaskInboxEventsForChatroom({
      sessionId: 'session_1',
      machineId: 'machine_1',
      chatroomId: 'room_1',
    });

    expect(query).toHaveBeenCalledWith(api.chatroomWorkspaceTaskInbox.listForChatroom, {
      sessionId: 'session_1',
      machineId: 'machine_1',
      chatroomId: 'room_1',
    });
    expect(result).toEqual([
      {
        eventId: 'event_1',
        eventType: 'task_assigned',
        status: 'processed',
        role: 'planner',
        taskId: 'task_1',
        taskStatus: 'pending',
        createdAt: 100,
        processedAt: 500,
      },
      {
        eventId: 'event_2',
        eventType: 'task_updated',
        status: 'pending',
        role: 'planner',
        taskId: 'task_1',
        taskStatus: 'pending',
        createdAt: 90,
      },
    ]);
  });
});
