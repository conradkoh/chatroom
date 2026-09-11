/**
 * User message → pending task → native daemon delivery path.
 *
 * Flow under test (happy path):
 * 1. Backend: messages.sendMessage → createTask(status=pending) → task inbox
 * 2. Backend: task inbox events feed the daemon task state
 * 3. Daemon: task-monitor onSignalRow → requestReconcile → reconcileRoleTasks
 * 4. Daemon: shouldDeliverNativeTask(slot idle + pid match) → runNativeInjectionEffect
 * 5. Daemon: claimTask → getTaskDeliveryPrompt → participants.join(native:task-injected) → resumeTurn
 *
 * Stuck-pending causes exercised here:
 * - slot.nativeTurnPhase !== 'idle' (turn still in flight)
 * - slot.harnessSessionId missing (agent not fully spawned)
 * - spawnedAgentPid mismatch between snapshot and local slot
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { resolveSessionAugmentationForTask } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { Context, Runtime } from 'effect';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  NativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import {
  createTaskSnapshot,
  snapshotDocToSignal,
  type TaskSnapshotFixtureDoc,
} from './test-fixtures/task-snapshot-fixture.js';
import { withTestTaskService } from './test-task-service.js';
import { api } from '../../../../../api.js';
import type { AssignedTaskWithContent } from '../../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../../entry/daemon-services.js';
import { buildNativeInjectionPrompt, shouldDeliverNativeTask } from '../../index.js';

const lifecycleOutbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

beforeEach(() => {
  lifecycleOutbox.enqueue.mockClear();
});

const HARNESS_SESSION_ID = 'harness-user-message';
const MACHINE_ID = 'machine-user-message-pending';
const SESSION_ID = 'session-user-message-pending';
const SPAWNED_PID = 42_424;
const MESSAGE_CONTENT = '## Goal\nPlease fix the pending delivery bug';

function makeUserMessagePendingSnapshotDoc(
  overrides: Partial<TaskSnapshotFixtureDoc> = {}
): TaskSnapshotFixtureDoc {
  const now = 1_700_000_000_000;
  return {
    machineId: MACHINE_ID,
    taskId: 'task_user_msg' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    role: 'builder',
    taskStatus: 'pending',
    taskAssignedTo: 'builder',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'cursor-sdk',
    workingDir: '/test/workspace',
    configUpdatedAt: now,
    revisionKey: 'revision-key',
    ...overrides,
  };
}

function makeIdleNativeSlot(overrides: Record<string, unknown> = {}) {
  return {
    state: 'running' as const,
    pid: SPAWNED_PID,
    harnessSessionId: HARNESS_SESSION_ID,
    nativeTurnPhase: 'idle' as const,
    ...overrides,
  };
}

function makeFullTaskFromRow(
  row: NonNullable<ReturnType<ReturnType<typeof createTaskSnapshot>['mergeSignal']>>
): AssignedTaskWithContent {
  return {
    ...row,
    taskContent: MESSAGE_CONTENT,
  };
}

describe('user message pending delivery path', () => {
  test('signal from sendMessage merges into daemon snapshot as deliverable pending row', () => {
    const snapshot = createTaskSnapshot();
    snapshot.replaceAll([]);

    const signal = snapshotDocToSignal(makeUserMessagePendingSnapshotDoc());
    const row = snapshot.mergeSignal(signal);

    expect(row).toBeDefined();
    expect(row).toMatchObject({
      taskId: 'task_user_msg',
      status: 'pending',
      assignedTo: 'builder',
      agentConfig: {
        role: 'builder',
        agentHarness: 'cursor-sdk',
      },
    });

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot(),
      })
    ).toBe(true);
  });

  test('coordinator injects first pending user-message task when agent slot is idle', async () => {
    const snapshot = createTaskSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();
    row!.agentConfig.spawnedAgentPid = SPAWNED_PID;

    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot()),
      resumeTurnForSlot,
    } as unknown as DaemonAgentProcessManagerServiceShape;

    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileRoleTasks(
      withTestTaskService({
        tasks: [row!],
        runtime: Runtime.defaultRuntime as Parameters<
          NativeTaskDeliveryCoordinator['reconcileRoleTasks']
        >[0]['runtime'],
        effectContext: Context.empty() as Parameters<
          NativeTaskDeliveryCoordinator['reconcileRoleTasks']
        >[0]['effectContext'],
        agentMgr,
        runSerializedForAgent: vi.fn(async (_key, _options, operation) =>
          operation(
            {
              startAgent: async () => ({ success: true }),
              stopAgent: async () => ({ success: true }),
            } as never,
            { signal: new AbortController().signal }
          )
        ) as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
          backend: {
            mutation: backendMutation,
            query: vi.fn(async (fn, args) => {
              if (args && 'machineId' in args && !('chatroomId' in args)) {
                return makeFullTaskFromRow(row!);
              }
              if (args && 'chatroomId' in args) {
                return { fullCliOutput: 'USER MESSAGE DELIVERY OUTPUT' };
              }
              throw new Error(`Unexpected query: ${String(fn)}`);
            }),
          },
        } satisfies NativeTaskDeliverySessionDeps,
        machineId: MACHINE_ID,
        lifecycleOutbox,
        isTaskActive: () => false,
      })
    );

    await vi.waitFor(() => {
      expect(resumeTurnForSlot).toHaveBeenCalled();
    });

    expect(backendMutation).toHaveBeenCalledWith(
      api.tasks.claimTask,
      expect.objectContaining({
        chatroomId: row!.chatroomId,
        role: 'builder',
        taskId: row!.taskId,
      })
    );
    expect(lifecycleOutbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'activity',
        action: NATIVE_TASK_INJECTED_ACTION,
        taskId: row!.taskId,
      })
    );
    expect(resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: row!.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'USER MESSAGE DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForTask(
          { content: MESSAGE_CONTENT, startInNewSession: undefined },
          'builder'
        ),
      }),
    });
  });

  test('stuck pending: does not inject when harness turn is still in flight', async () => {
    const snapshot = createTaskSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot({ nativeTurnPhase: 'turn_in_flight' }),
      })
    ).toBe(false);

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileRoleTasks(
      withTestTaskService({
        tasks: [row!],
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        agentMgr: {
          getSlot: vi
            .fn()
            .mockReturnValue(makeIdleNativeSlot({ nativeTurnPhase: 'turn_in_flight' })),
          resumeTurnForSlot,
        } as unknown as DaemonAgentProcessManagerServiceShape,
        runSerializedForAgent: vi.fn() as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
          backend: {
            mutation: vi.fn(),
            query: vi.fn(),
          },
        },
        machineId: MACHINE_ID,
        lifecycleOutbox,
        isTaskActive: () => false,
      })
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('stuck pending: does not inject when harness session id is missing on slot', async () => {
    const snapshot = createTaskSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot({ harnessSessionId: undefined }),
      })
    ).toBe(false);

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileRoleTasks(
      withTestTaskService({
        tasks: [row!],
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        agentMgr: {
          getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot({ harnessSessionId: undefined })),
          resumeTurnForSlot,
        } as unknown as DaemonAgentProcessManagerServiceShape,
        runSerializedForAgent: vi.fn() as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
          backend: {
            mutation: vi.fn(),
            query: vi.fn(),
          },
        },
        machineId: MACHINE_ID,
        lifecycleOutbox,
        isTaskActive: () => false,
      })
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('stuck pending: does not inject when local slot is spawning with a mismatched PID', async () => {
    const snapshot = createTaskSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();
    row!.agentConfig.spawnedAgentPid = SPAWNED_PID;

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot({ pid: SPAWNED_PID + 1, state: 'spawning' }),
      })
    ).toBe(false);

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileRoleTasks(
      withTestTaskService({
        tasks: [row!],
        runtime: Runtime.defaultRuntime as never,
        effectContext: Context.empty() as never,
        agentMgr: {
          getSlot: vi
            .fn()
            .mockReturnValue(makeIdleNativeSlot({ pid: SPAWNED_PID + 1, state: 'spawning' })),
          resumeTurnForSlot,
        } as unknown as DaemonAgentProcessManagerServiceShape,
        runSerializedForAgent: vi.fn() as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
          backend: {
            mutation: vi.fn(),
            query: vi.fn(),
          },
        },
        machineId: MACHINE_ID,
        lifecycleOutbox,
        isTaskActive: () => false,
      })
    );

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });
});
