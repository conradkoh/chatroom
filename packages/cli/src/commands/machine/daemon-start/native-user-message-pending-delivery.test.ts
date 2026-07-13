/**
 * User message → pending task → native daemon delivery path.
 *
 * Flow under test (happy path):
 * 1. Backend: messages.sendMessage → createTask(status=pending) → projectAssignedTaskSnapshots
 * 2. Backend: subscribeAssignedTaskSignalsSince emits incremental row (covered in backend IT)
 * 3. Daemon: task-monitor onSignalRow → processTasksUpdate → reconcileAssignedTasks
 * 4. Daemon: shouldDeliverNativeTask(slot idle + pid match) → runNativeInjectionEffect
 * 5. Daemon: claimTask → getTaskDeliveryPrompt → participants.join(native:task-injected) → resumeTurn
 *
 * Stuck-pending causes exercised here:
 * - slot.nativeTurnPhase !== 'idle' (turn still in flight)
 * - slot.harnessSessionId missing (agent not fully spawned)
 * - spawnedAgentPid mismatch between snapshot and local slot
 */

import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { resolveSessionAugmentationForRole } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { snapshotDocToSignal } from '@workspace/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.js';
import { Context, Effect, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import {
  NativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import {
  buildNativeInjectionPrompt,
  shouldDeliverNativeTask,
} from './native-task-injector-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';
import { api } from '../../../api.js';

const HARNESS_SESSION_ID = 'harness-user-message';
const MACHINE_ID = 'machine-user-message-pending';
const SESSION_ID = 'session-user-message-pending';
const SPAWNED_PID = 42_424;
const MESSAGE_CONTENT = '## Goal\nPlease fix the pending delivery bug';

function makeUserMessagePendingSnapshotDoc(
  overrides: Partial<Doc<'chatroom_machineAssignedTaskSnapshots'>> = {}
): Doc<'chatroom_machineAssignedTaskSnapshots'> {
  const now = 1_700_000_000_000;
  return {
    _id: 'snapshot_user_msg' as Id<'chatroom_machineAssignedTaskSnapshots'>,
    _creationTime: now,
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
    spawnedAgentPid: SPAWNED_PID,
    desiredState: 'running',
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-key',
    revisionKey: 'revision-key',
    signalUpdatedAt: now,
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
  row: NonNullable<ReturnType<ReturnType<typeof createTaskMonitorSnapshot>['mergeSignal']>>
): AssignedTaskView {
  return {
    ...row,
    taskContent: MESSAGE_CONTENT,
  };
}

describe('user message pending delivery path', () => {
  test('signal from sendMessage merges into daemon snapshot as deliverable pending row', () => {
    const snapshot = createTaskMonitorSnapshot();
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
        spawnedAgentPid: SPAWNED_PID,
        desiredState: 'running',
      },
    });

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot(),
      })
    ).toBe(true);
  });

  test('coordinator injects first pending user-message task when agent slot is idle', async () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();

    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot()),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
    } as unknown as DaemonAgentProcessManagerServiceShape;

    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileAssignedTasks({
      tasks: [row!],
      runtime: Runtime.defaultRuntime as Parameters<
        NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
      >[0]['runtime'],
      effectContext: Context.empty() as Parameters<
        NativeTaskDeliveryCoordinator['reconcileAssignedTasks']
      >[0]['effectContext'],
      agentMgr,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
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
    });

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
    expect(backendMutation).toHaveBeenCalledWith(
      api.participants.join,
      expect.objectContaining({
        action: NATIVE_TASK_INJECTED_ACTION,
        taskId: row!.taskId,
      })
    );
    expect(resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: row!.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'USER MESSAGE DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForRole(MESSAGE_CONTENT, 'builder'),
      }),
    });
  });

  test('stuck pending: does not inject when harness turn is still in flight', async () => {
    const snapshot = createTaskMonitorSnapshot();
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
    coordinator.reconcileAssignedTasks({
      tasks: [row!],
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot({ nativeTurnPhase: 'turn_in_flight' })),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as DaemonAgentProcessManagerServiceShape,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: {
          mutation: vi.fn(),
          query: vi.fn(),
        },
      },
      machineId: MACHINE_ID,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('stuck pending: does not inject when harness session id is missing on slot', async () => {
    const snapshot = createTaskMonitorSnapshot();
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
    coordinator.reconcileAssignedTasks({
      tasks: [row!],
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot({ harnessSessionId: undefined })),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as DaemonAgentProcessManagerServiceShape,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: {
          mutation: vi.fn(),
          query: vi.fn(),
        },
      },
      machineId: MACHINE_ID,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });

  test('stuck pending: does not inject when local slot pid mismatches snapshot spawnedAgentPid', async () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makeUserMessagePendingSnapshotDoc()));
    expect(row).toBeDefined();

    expect(
      shouldDeliverNativeTask(row!, {
        slot: makeIdleNativeSlot({ pid: SPAWNED_PID + 1 }),
      })
    ).toBe(false);

    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileAssignedTasks({
      tasks: [row!],
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {
        getSlot: vi.fn().mockReturnValue(makeIdleNativeSlot({ pid: SPAWNED_PID + 1 })),
        resumeTurnForSlot,
        setLastInFlightTask: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as DaemonAgentProcessManagerServiceShape,
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend: {
          mutation: vi.fn(),
          query: vi.fn(),
        },
      },
      machineId: MACHINE_ID,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
  });
});
