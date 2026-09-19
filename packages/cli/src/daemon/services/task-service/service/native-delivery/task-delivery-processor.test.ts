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
    const order: string[] = [];
    const onTaskDeliveryStarted = vi.fn(() => order.push('started'));
    const onTaskDeliveryFailed = vi.fn();
    const onTaskDelivered = vi.fn();
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const deliverNativeTask = vi.fn(async (_task, _session, onDelivered) => {
      order.push('deliver');
      onDelivered?.({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      });
    });
    let capturedDeliver: ((task: never, agentConfig: never) => Promise<unknown>) | undefined;
    let capturedOnTaskDelivered: ((args: never) => void) | undefined;
    const reconcileSpy = vi
      .spyOn(NativeTaskDeliveryCoordinator.prototype, 'reconcileRoleTasks')
      .mockImplementation(async (params) => {
        capturedDeliver = params.executors.deliverTask as never;
        capturedOnTaskDelivered = params.onTaskDelivered as never;
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
        { tasks: [row], onTaskDeliveryStarted, onTaskDeliveryFailed, onTaskDelivered },
        vi.fn(async () => ({ harnessSessionId: 'harness-1' })) as never
      );

      expect(capturedDeliver).toBeDefined();
      const result = await capturedDeliver?.(row, config as never);
      expect(loadAssignedTaskForAction).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
      });
      expect(onTaskDeliveryStarted).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      });
      expect(order).toEqual(['started', 'deliver']);
      expect(onTaskDeliveryFailed).not.toHaveBeenCalled();
      expect(deliverNativeTask).toHaveBeenCalledWith(full, 'harness-1', expect.any(Function));
      expect(result).toMatchObject({ kind: 'delivered' });
      capturedOnTaskDelivered?.({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      } as never);
      expect(onTaskDelivered).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      });
    } finally {
      reconcileSpy.mockRestore();
    }
  });

  test('merged delivery returns task-unavailable when hydration is null', async () => {
    const row = snapshotRow();
    const onTaskDeliveryStarted = vi.fn();
    const onTaskDeliveryFailed = vi.fn();
    const loadAssignedTaskForAction = vi.fn(async () => null);
    const deliverNativeTask = vi.fn(async () => undefined);
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
        { tasks: [row], onTaskDeliveryStarted, onTaskDeliveryFailed },
        vi.fn(async () => ({ harnessSessionId: 'harness-1' })) as never
      );

      const result = await capturedDeliver?.(row, config as never);
      expect(result).toEqual({ kind: 'task-unavailable' });
      expect(deliverNativeTask).not.toHaveBeenCalled();
      expect(onTaskDeliveryStarted).not.toHaveBeenCalled();
      expect(onTaskDeliveryFailed).not.toHaveBeenCalled();
    } finally {
      reconcileSpy.mockRestore();
    }
  });

  test('signals failed delivery when injection is not confirmed', async () => {
    const row = snapshotRow();
    const full = fullTask();
    const onTaskDeliveryStarted = vi.fn();
    const onTaskDeliveryFailed = vi.fn();
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const deliverNativeTask = vi.fn(async () => undefined);
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
        { tasks: [row], onTaskDeliveryStarted, onTaskDeliveryFailed },
        vi.fn(async () => ({ harnessSessionId: 'harness-1' })) as never
      );

      const result = await capturedDeliver?.(row, config as never);
      expect(result).toEqual({ kind: 'failed', reason: 'injection_not_confirmed' });
      expect(onTaskDeliveryStarted).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
      });
      expect(onTaskDeliveryFailed).toHaveBeenCalledTimes(1);
      expect(onTaskDeliveryFailed).toHaveBeenCalledWith({
        chatroomId: CHATROOM_ID,
        role: ROLE,
        taskId: TASK_ID,
        harnessSessionId: 'harness-1',
        reason: 'injection_not_confirmed',
      });
    } finally {
      reconcileSpy.mockRestore();
    }
  });

  test('signals failed delivery before rethrowing an injection error', async () => {
    const row = snapshotRow();
    const full = fullTask();
    const onTaskDeliveryStarted = vi.fn();
    const onTaskDeliveryFailed = vi.fn();
    const error = new Error('injection failed');
    const loadAssignedTaskForAction = vi.fn(async () => full);
    const deliverNativeTask = vi.fn(async () => {
      throw error;
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
        { tasks: [row], onTaskDeliveryStarted, onTaskDeliveryFailed },
        vi.fn(async () => ({ harnessSessionId: 'harness-1' })) as never
      );

      await expect(capturedDeliver?.(row, config as never)).rejects.toBe(error);
      expect(onTaskDeliveryStarted).toHaveBeenCalledTimes(1);
      expect(onTaskDeliveryFailed).toHaveBeenCalledTimes(1);
      expect(onTaskDeliveryFailed).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'injection_not_confirmed', taskId: TASK_ID })
      );
    } finally {
      reconcileSpy.mockRestore();
    }
  });
});
