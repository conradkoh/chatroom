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
    agentConfig: { role: ROLE, machineId: 'machine_processor' },
    assignee: {
      type: 'permanent' as const,
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
    taskContent: 'Do the thing',
  } as never;
}

const config = { agentHarness: 'cursor-sdk', model: 'model-1', workingDir: '/test' };

describe('task-delivery-processor exact-task hydration', () => {
  test('merged delivery hydrates before deliverNativeTask', async () => {
    const row = snapshotRow();
    const full = fullTask();
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const deliverNativeTask = vi.fn(async (_task, _session, onDelivered) => {
      onDelivered?.({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      });
    });
    let capturedDeliver: ((task: never, agentConfig: never) => Promise<unknown>) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedDeliver = params.executors.deliverTask as never;
        return [];
      });

    try {
      await processTasksUpdate(
        {
          deliverNativeTask,
          loadAssignedTaskForAction,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          releaseTaskAfterTurnFailure: async () => ({
            released: false,
            status: 'pending',
            updatedAt: 0,
          }),
        } as never,
        { get: () => config } as never,
        'bootstrap',
        () => false,
        { tasks: [row] },
        vi.fn(async () => ({ harnessSessionId: 'harness-1' })) as never
      );

      expect(capturedDeliver).toBeDefined();
      const result = await capturedDeliver?.(row, config as never);
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

  test('merged delivery returns task-unavailable when hydration is null', async () => {
    const row = snapshotRow();
    const loadAssignedTaskForAction = vi.fn(async () => null);
    const deliverNativeTask = vi.fn(async () => undefined);
    const forgetStaleTask = vi.fn();
    const acquireNativeDeliverySlot = vi.fn(async () => ({ harnessSessionId: 'harness-1' }));
    let capturedDeliver: ((task: never, agentConfig: never) => Promise<unknown>) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedDeliver = params.executors.deliverTask as never;
        return [];
      });

    try {
      await processTasksUpdate(
        {
          deliverNativeTask,
          loadAssignedTaskForAction,
          forgetStaleTask,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          releaseTaskAfterTurnFailure: async () => ({
            released: false,
            status: 'pending',
            updatedAt: 0,
          }),
        } as never,
        { get: () => config } as never,
        'bootstrap',
        () => false,
        { tasks: [row] },
        acquireNativeDeliverySlot as never
      );

      const result = await capturedDeliver?.(row, config as never);
      expect(result).toEqual({ kind: 'task-unavailable', stale: true });
      expect(forgetStaleTask).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
      });
      expect(acquireNativeDeliverySlot).not.toHaveBeenCalled();
      expect(deliverNativeTask).not.toHaveBeenCalled();
    } finally {
      reconcileSpy.mockRestore();
    }
  });

  test('keeps a live task retryable when native slot acquisition is unavailable', async () => {
    const row = snapshotRow();
    const full = fullTask();
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const forgetStaleTask = vi.fn();
    let capturedDeliver: ((task: never, agentConfig: never) => Promise<unknown>) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedDeliver = params.executors.deliverTask as never;
        return [];
      });

    try {
      await processTasksUpdate(
        {
          deliverNativeTask: vi.fn(),
          loadAssignedTaskForAction,
          forgetStaleTask,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          releaseTaskAfterTurnFailure: async () => ({
            released: false,
            status: 'pending',
            updatedAt: 0,
          }),
        } as never,
        { get: () => config } as never,
        'bootstrap',
        () => false,
        { tasks: [row] },
        vi.fn(async () => null) as never
      );

      const result = await capturedDeliver?.(row, config as never);
      expect(result).toEqual({ kind: 'task-unavailable' });
      expect(loadAssignedTaskForAction).toHaveBeenCalledTimes(2);
      expect(forgetStaleTask).not.toHaveBeenCalled();
    } finally {
      reconcileSpy.mockRestore();
    }
  });
});
