import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  NativeTaskDeliveryCoordinator,
  resetRoleDeliveryState,
} from './native-task-delivery-coordinator.js';
import { TaskAssigneeType } from '../../../../domain/entities/assigned-task.js';

const CHATROOM_ID = 'room_coordinator_facade';
const ROLE = 'builder';
const TASK_ID = 'task_coordinator_1';
const HARNESS_SESSION_ID = 'harness-coordinator-session';

function acknowledgedRow() {
  return {
    taskId: TASK_ID,
    chatroomId: CHATROOM_ID,
    status: 'acknowledged' as const,
    assignedTo: ROLE,
    updatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    agentConfig: {
      role: ROLE,
      machineId: 'machine_coordinator',
    },
    assignee: {
      type: TaskAssigneeType.Ephemeral,
      ephemeral: { agentHarness: 'cursor-sdk', model: 'model-1', workingDir: '/test' },
    },
    participant: {
      lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
      lastSeenAt: 1_700_000_000_000,
      lastStatus: 'task.acknowledged',
    },
  } as never;
}

function baseParams(overrides: Record<string, any> = {}) {
  const taskService = overrides.taskService;
  const executors = overrides.executors ?? {
    deliverTask: async (row: any) => {
      const full = await taskService.loadAssignedTaskForAction({
        chatroomId: row.chatroomId,
        role: row.agentConfig.role,
        taskId: row.taskId,
      });
      if (!full) return { kind: 'task-unavailable' as const };
      let delivered: any;
      await taskService.deliverNativeTask(full, 'harness-coordinator-session', (result: any) => {
        delivered = result;
      });
      return { kind: 'delivered' as const, ...(delivered ? { delivered } : {}) };
    },
  };
  return {
    tasks: [acknowledgedRow()],
    configurationService: {
      get: () => undefined,
      state: () => 'ready',
    },
    executors,
    sessionDeps: {
      sessionId: 'session_coordinator',
      machineId: 'machine_coordinator',
      convexUrl: 'http://test:3210',
      backend: { mutation: vi.fn(), query: vi.fn() },
    } as never,
    lifecycleOutbox: { enqueue: async () => undefined },
    isTaskActive: () => false,
    machineId: 'machine_coordinator',
    ...overrides,
  } as never;
}

describe('native-task-delivery-coordinator exact-task hydration', () => {
  afterEach(() => {
    resetRoleDeliveryState(CHATROOM_ID, ROLE);
    vi.restoreAllMocks();
  });

  test('default injection path hydrates through TaskService.loadAssignedTaskForAction and delivers the full task', async () => {
    const row = acknowledgedRow();
    const full = { ...(row as unknown as Record<string, unknown>), taskContent: 'Do the thing' };
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
          harnessSessionId: HARNESS_SESSION_ID,
        } as never);
      }
    );
    const onTaskDelivered = vi.fn();
    const coordinator = new NativeTaskDeliveryCoordinator();
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await coordinator.reconcileRoleTasks(
      baseParams({
        taskService: {
          deliverNativeTask,
          loadAssignedTaskForAction,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          isRedeliveryExhausted: () => false,
        },
        onTaskDelivered,
      })
    );

    expect(loadAssignedTaskForAction).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: ROLE,
      taskId: TASK_ID,
    });
    expect(deliverNativeTask).toHaveBeenCalledWith(full, HARNESS_SESSION_ID, expect.any(Function));
    expect(onTaskDelivered).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: ROLE,
      taskId: TASK_ID,
      harnessSessionId: HARNESS_SESSION_ID,
    });
  });

  test('missing hydration skips delivery and preserves the task_hydration_missing warning', async () => {
    const loadAssignedTaskForAction = vi.fn(async () => null);
    const deliverNativeTask = vi.fn(async () => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const coordinator = new NativeTaskDeliveryCoordinator();

    await coordinator.reconcileRoleTasks(
      baseParams({
        taskService: {
          deliverNativeTask,
          loadAssignedTaskForAction,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          isRedeliveryExhausted: () => false,
        },
      })
    );

    expect(loadAssignedTaskForAction).toHaveBeenCalledWith({
      chatroomId: CHATROOM_ID,
      role: ROLE,
      taskId: TASK_ID,
    });
    expect(deliverNativeTask).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('task_hydration_missing'));
  });

  test('stale hydration does not record a retryable delivery failure', async () => {
    const recordDeliveryFailure = vi.fn();
    const coordinator = new NativeTaskDeliveryCoordinator();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await coordinator.reconcileRoleTasks(
      baseParams({
        taskService: {
          recordDeliveryFailure,
          isNativeHarness: () => true,
          explainNativeDeliveryBlock: () => null,
          isRedeliveryExhausted: () => false,
        },
        executors: {
          deliverTask: async () => ({ kind: 'task-unavailable' as const, stale: true }),
        },
      })
    );

    expect(recordDeliveryFailure).not.toHaveBeenCalled();
  });
});
