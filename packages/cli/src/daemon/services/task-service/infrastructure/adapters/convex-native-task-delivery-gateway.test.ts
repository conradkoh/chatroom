import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import type { FunctionReturnType } from 'convex/server';
import { describe, expect, expectTypeOf, test, vi } from 'vitest';

import {
  createConvexNativeTaskDeliveryGateway,
  mapPendingTaskInboxRows,
  type PendingTaskInboxRow,
} from './convex-native-task-delivery-gateway.js';
import { api } from '../../../../../api.js';

function pendingInboxRow() {
  return {
    _id: 'event-valid-1',
    machineId: 'machine_1',
    chatroomId: 'room_1',
    taskId: 'task_1',
    role: 'builder',
    assignee: { type: 'permanent' },
    eventType: WorkspaceTaskInboxEventType.TaskAssigned,
    status: WorkspaceTaskInboxEventStatus.Pending,
    createdAt: 1_000,
    task: {
      taskId: 'task_1',
      chatroomId: 'room_1',
      status: 'pending',
      assignedTo: 'builder',
      createdAt: 900,
      updatedAt: 950,
      startInNewSession: false,
    },
  };
}

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

describe('mapPendingTaskInboxRows', () => {
  test('maps a legacy fat row to the header only', () => {
    const [event] = mapPendingTaskInboxRows([
      {
        _id: 'event-legacy-1',
        machineId: 'machine_1',
        chatroomId: 'room_1',
        taskId: 'task_1',
        role: 'builder',
        assignee: { type: 'permanent' },
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 1_000,
        task: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'pending',
          assignedTo: 'builder',
          createdAt: 900,
          updatedAt: 950,
          startInNewSession: false,
          createdBy: 'user_1',
          content: 'Do the thing',
          queuePosition: 3,
          taskEnvelope: { foo: 'bar' },
          agentHarness: 'cursor-sdk',
        },
      },
    ]);

    expect(event.task).toEqual({
      taskId: 'task_1',
      chatroomId: 'room_1',
      status: 'pending',
      assignedTo: 'builder',
      createdAt: 900,
      updatedAt: 950,
      startInNewSession: false,
    });
    expect(event.task).not.toHaveProperty('content');
    expect(event.task).not.toHaveProperty('createdBy');
    expect(event.task).not.toHaveProperty('queuePosition');
    expect(event.task).not.toHaveProperty('taskEnvelope');
    expect(event.task).not.toHaveProperty('agentHarness');
  });

  test('maps a slim header-only row to the same header and eventId from _id', () => {
    const [event] = mapPendingTaskInboxRows([
      {
        _id: 'event-slim-1',
        machineId: 'machine_1',
        chatroomId: 'room_1',
        taskId: 'task_1',
        role: 'builder',
        assignee: { type: 'permanent' },
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 1_000,
        task: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'pending',
          assignedTo: 'builder',
          createdAt: 900,
          updatedAt: 950,
          startInNewSession: false,
        },
      },
    ]);

    expect(event).toEqual({
      eventId: 'event-slim-1',
      machineId: 'machine_1',
      chatroomId: 'room_1',
      taskId: 'task_1',
      role: 'builder',
      assignee: { type: 'permanent' },
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 1_000,
      task: {
        taskId: 'task_1',
        chatroomId: 'room_1',
        status: 'pending',
        assignedTo: 'builder',
        createdAt: 900,
        updatedAt: 950,
        startInNewSession: false,
      },
    });
    expect(event.eventId).toBe('event-slim-1');
  });

  test('keeps absent optionals absent', () => {
    const [event] = mapPendingTaskInboxRows([
      {
        _id: 'event-min-1',
        machineId: 'machine_1',
        chatroomId: 'room_1',
        taskId: 'task_1',
        role: 'builder',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 1_000,
        task: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'pending',
          createdAt: 900,
          updatedAt: 950,
        },
      },
    ]);

    expect(event).not.toHaveProperty('assignee');
    expect(event).not.toHaveProperty('processedAt');
    expect(event.task).not.toHaveProperty('assignedTo');
    expect(event.task).not.toHaveProperty('startInNewSession');
  });

  test('backend listPending rows are valid parser input (compile-time drift guard)', () => {
    expectTypeOf<
      FunctionReturnType<typeof api.chatroomWorkspaceTaskInbox.listPending>[number]
    >().toExtend<PendingTaskInboxRow>();
  });

  test('parses an ephemeral assignee', () => {
    const [event] = mapPendingTaskInboxRows([
      {
        ...pendingInboxRow(),
        assignee: {
          type: 'ephemeral',
          ephemeral: { agentHarness: 'cursor-sdk', model: 'gpt-4', workingDir: '/tmp/ws' },
        },
      },
    ]);

    expect(event.assignee).toEqual({
      type: 'ephemeral',
      ephemeral: { agentHarness: 'cursor-sdk', model: 'gpt-4', workingDir: '/tmp/ws' },
    });
  });

  test('skips a malformed row and keeps the valid ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const valid = pendingInboxRow();
      const events = mapPendingTaskInboxRows([
        valid,
        { ...valid, _id: 'event-bad-1', task: { ...valid.task, createdAt: 'x' } },
        { ...valid, _id: 'event-bad-2', eventType: 'bogus' },
      ]);

      expect(events).toHaveLength(1);
      expect(events[0].eventId).toBe('event-valid-1');
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  test('drops unknown top-level fields', () => {
    const [event] = mapPendingTaskInboxRows([
      { ...pendingInboxRow(), processedAt: 1_234, agentHarness: 'cursor-sdk', _creationTime: 5 },
    ]);

    expect(event).not.toHaveProperty('processedAt');
    expect(event).not.toHaveProperty('agentHarness');
    expect(event).not.toHaveProperty('_creationTime');
  });

  test('throws when the payload is not an array', () => {
    expect(() => mapPendingTaskInboxRows(null)).toThrow();
    expect(() => mapPendingTaskInboxRows({})).toThrow();
  });
});

describe('createConvexNativeTaskDeliveryGateway.listPendingTaskInboxEvents', () => {
  test('parses through the zod wire schema', async () => {
    const query = vi.fn(async () => [pendingInboxRow()]);
    const gateway = createConvexNativeTaskDeliveryGateway({
      mutation: vi.fn(async () => undefined),
      query,
    });

    const events = await gateway.listPendingTaskInboxEvents({
      sessionId: 'session_1',
      machineId: 'machine_1',
    });

    expect(query).toHaveBeenCalledWith(api.chatroomWorkspaceTaskInbox.listPending, {
      sessionId: 'session_1',
      machineId: 'machine_1',
    });
    expect(events).toEqual([
      {
        eventId: 'event-valid-1',
        machineId: 'machine_1',
        chatroomId: 'room_1',
        taskId: 'task_1',
        role: 'builder',
        assignee: { type: 'permanent' },
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 1_000,
        task: {
          taskId: 'task_1',
          chatroomId: 'room_1',
          status: 'pending',
          assignedTo: 'builder',
          createdAt: 900,
          updatedAt: 950,
          startInNewSession: false,
        },
      },
    ]);
  });
});
