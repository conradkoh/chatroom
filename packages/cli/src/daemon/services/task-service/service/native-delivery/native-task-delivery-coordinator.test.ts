import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { Context, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  NativeTaskDeliveryCoordinator,
  resetRoleDeliveryState,
} from './native-task-delivery-coordinator.js';
import { TaskAssigneeType } from '../../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../../entry/daemon-services.js';

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
      spawnedAgentPid: 42_001,
      desiredState: 'running' as const,
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

function agentMgr() {
  return {
    getSlot: vi.fn().mockReturnValue({
      state: 'running',
      harness: 'cursor-sdk',
      model: 'model-1',
      workingDir: '/test',
      pid: 42_001,
      harnessSessionId: HARNESS_SESSION_ID,
      nativeTurnPhase: 'idle' as const,
    }),
    resumeTurnForSlot: vi.fn(),
  } as unknown as DaemonAgentProcessManagerServiceShape;
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    tasks: [acknowledgedRow()],
    runtime: Runtime.defaultRuntime as never,
    effectContext: Context.empty() as never,
    agentMgr: agentMgr(),
    runSerializedForAgent: vi.fn() as never,
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
          taskRequestsNativeColdSession: () => false,
          explainNativeDeliveryBlock: () => null,
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
          taskRequestsNativeColdSession: () => false,
          explainNativeDeliveryBlock: () => null,
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
});
