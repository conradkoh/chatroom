import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { describe, expect, test, vi } from 'vitest';

import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import { processTasksUpdate } from './task-delivery-processor.js';

const CHATROOM_ID = 'room_processor_facade';
const ROLE = 'builder';
const TASK_ID = 'task_processor_1';

function snapshotRow() {
  return {
    taskId: TASK_ID,
    chatroomId: CHATROOM_ID,
    status: 'pending' as const,
    assignedTo: ROLE,
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role: ROLE,
      machineId: 'machine_processor',
      agentHarness: 'cursor-sdk',
      workingDir: '/test',
      spawnedAgentPid: 42_001,
      desiredState: 'running' as const,
    },
    participant: {
      lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'task.acknowledged',
    },
  } as never;
}

function fullTask() {
  return {
    ...(snapshotRow() as unknown as Record<string, unknown>),
    taskContent: '## Goal\nProcessor facade test',
  } as never;
}

describe('task-delivery-processor exact-task hydration', () => {
  test('injectTask hydrates through TaskService.loadAssignedTaskForAction before deliverNativeTask', async () => {
    const row = snapshotRow();
    const full = fullTask();
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const deliverNativeTask = vi.fn(
      async (
        _task: unknown,
        _harnessSessionId: unknown,
        onTaskDelivered?: (args: never) => void
      ) => {
        onTaskDelivered?.({
          chatroomId: CHATROOM_ID,
          role: ROLE,
          taskId: TASK_ID,
          harnessSessionId: 'harness-1',
        } as never);
      }
    );
    let capturedInject:
      ((task: never, harnessSessionId: string | undefined) => Promise<unknown>) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedInject = params.executors?.injectTask as never;
      });

    try {
      await processTasksUpdate(
        {} as never,
        {} as never,
        {} as never,
        (async () => undefined) as never,
        {
          deliverNativeTask,
          loadAssignedTaskForAction,
          isNativeHarness: () => true,
          snapshotRequestsNativeColdSession: () => false,
          explainNativeDeliveryBlock: () => null,
        } as never,
        {
          sessionId: 'session_processor',
          machineId: 'machine_processor',
          convexUrl: 'http://test:3210',
          backend: { mutation: vi.fn(), query: vi.fn() },
        } as never,
        'machine_processor',
        'bootstrap',
        { enqueue: async () => undefined } as never,
        () => false,
        { snapshots: [row] }
      );

      expect(capturedInject).toBeDefined();
      const result = await capturedInject?.(row as never, 'harness-1');

      expect(loadAssignedTaskForAction).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
      });
      expect(deliverNativeTask).toHaveBeenCalledWith(full, 'harness-1', expect.any(Function));
      expect(result).toMatchObject({ kind: 'delivered' });
    } finally {
      reconcileSpy.mockRestore();
    }
  });

  test('injectTask returns task-unavailable without delivering when hydration is null', async () => {
    const row = snapshotRow();
    const loadAssignedTaskForAction = vi.fn(async () => null);
    const deliverNativeTask = vi.fn(async () => undefined);
    let capturedInject:
      ((task: never, harnessSessionId: string | undefined) => Promise<unknown>) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedInject = params.executors?.injectTask as never;
      });

    try {
      await processTasksUpdate(
        {} as never,
        {} as never,
        {} as never,
        (async () => undefined) as never,
        {
          deliverNativeTask,
          loadAssignedTaskForAction,
          isNativeHarness: () => true,
          snapshotRequestsNativeColdSession: () => false,
          explainNativeDeliveryBlock: () => null,
        } as never,
        {
          sessionId: 'session_processor',
          machineId: 'machine_processor',
          convexUrl: 'http://test:3210',
          backend: { mutation: vi.fn(), query: vi.fn() },
        } as never,
        'machine_processor',
        'bootstrap',
        { enqueue: async () => undefined } as never,
        () => false,
        { snapshots: [row] }
      );

      const result = await capturedInject?.(row as never, undefined);

      expect(result).toEqual({ kind: 'task-unavailable' });
      expect(deliverNativeTask).not.toHaveBeenCalled();
    } finally {
      reconcileSpy.mockRestore();
    }
  });
});
