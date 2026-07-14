/**
 * Daemon native delivery after agent_end + queue promotion — integration test
 *
 * Uses mocked harness (no real LLM calls). Included in default `pnpm test` suite.
 * Uses snapshot/participant shape produced by backend integration test.
 * Wires NativeTaskDeliveryCoordinator → runNativeInjectionEffect → resumeTurn.
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
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery-session-registry.js';
import {
  NativeTaskDeliveryCoordinator,
  notifyNativeTurnIdle,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import {
  buildNativeInjectionPrompt,
  shouldDeliverNativeTask,
} from './native-task-injector-logic.js';
import { createTaskMonitorSnapshot } from './task-monitor-snapshot.js';
import { api } from '../../../api.js';
import {
  clearAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../../infrastructure/stores/assigned-task-snapshot-store.js';

const HARNESS_SESSION_ID = 'harness-session-post-agent-end';
const MACHINE_ID = 'machine-native-queued-delivery';
const SESSION_ID = 'session-native-queued-delivery';

function makePostAgentEndSnapshotDoc(
  overrides: Partial<Doc<'chatroom_machineAssignedTaskSnapshots'>> = {}
): Doc<'chatroom_machineAssignedTaskSnapshots'> {
  const now = 1_700_000_000_000;
  return {
    _id: 'snapshot_promoted' as Id<'chatroom_machineAssignedTaskSnapshots'>,
    _creationTime: now,
    machineId: MACHINE_ID,
    taskId: 'task_promoted' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    role: 'builder',
    taskStatus: 'pending',
    taskAssignedTo: 'builder',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'cursor-sdk',
    workingDir: '/test/workspace',
    spawnedAgentPid: 42_424,
    desiredState: 'running' as const,
    configUpdatedAt: now,
    presenceUpdatedAt: now,
    presenceKey: 'presence-key',
    revisionKey: 'revision-key',
    signalUpdatedAt: now,
    lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
    lastStatus: 'task.completed',
    lastSeenAt: now - 1_000,
    ...overrides,
  };
}

function makeFullTaskFromSnapshot(
  row: NonNullable<ReturnType<ReturnType<typeof createTaskMonitorSnapshot>['mergeSignal']>>
): AssignedTaskView {
  return {
    ...row,
    taskContent: '## Goal\nQueued follow-up after agent_end',
  };
}

describe('native queued delivery after agent_end', () => {
  test('coordinator injects promoted pending task when participant is idle-after-complete', async () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makePostAgentEndSnapshotDoc()));
    expect(row).toBeDefined();

    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42_424,
        harnessSessionId: HARNESS_SESSION_ID,
        nativeTurnPhase: 'idle',
      }),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
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
              return makeFullTaskFromSnapshot(row!);
            }
            if (args && 'chatroomId' in args) {
              return { fullCliOutput: 'DELIVERY OUTPUT' };
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

    expect(resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: row!.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForRole(
          '## Goal\nQueued follow-up after agent_end',
          'builder'
        ),
      }),
    });
    expect(backendMutation).toHaveBeenCalledWith(
      api.participants.join,
      expect.objectContaining({
        action: NATIVE_TASK_INJECTED_ACTION,
        taskId: row!.taskId,
      })
    );
  });

  test('shouldDeliverNativeTask true for post-agent_end participant shape', () => {
    const snapshot = createTaskMonitorSnapshot();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(snapshotDocToSignal(makePostAgentEndSnapshotDoc()));
    expect(row).toBeDefined();

    const slot = {
      state: 'running' as const,
      pid: 42_424,
      harnessSessionId: HARNESS_SESSION_ID,
      nativeTurnPhase: 'idle' as const,
    };
    expect(shouldDeliverNativeTask(row!, { slot })).toBe(true);
  });

  test('notifyNativeTurnIdle injects promoted pending task via event path', async () => {
    unregisterNativeDeliverySession();
    clearAssignedTaskSnapshots();
    const now = 1_700_000_000_000;

    const baseRow = {
      taskId: 'task_promoted' as never,
      chatroomId: 'room_1' as never,
      status: 'pending' as const,
      assignedTo: 'builder',
      updatedAt: now,
      createdAt: now,
      agentConfig: {
        role: 'builder',
        machineId: MACHINE_ID,
        agentHarness: 'cursor-sdk',
        workingDir: '/test/workspace',
        spawnedAgentPid: 42_424,
        desiredState: 'running' as const,
      },
      participant: {
        lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
        lastSeenAt: now - 1_000,
        lastStatus: 'task.completed',
      },
    };

    replaceAssignedTaskSnapshots([baseRow]);

    const backendQuery = vi.fn(async (_fn: unknown, args: unknown) => {
      const a = args as Record<string, unknown>;
      if (a && 'chatroomId' in a && 'taskId' in a) {
        return { fullCliOutput: 'EVENT DRIVEN OUTPUT' };
      }
      if (a && 'taskId' in a) {
        return { ...baseRow, taskContent: '## Goal\nQueued follow-up after agent_end' };
      }
      throw new Error(`Unexpected query: ${String(_fn)}`);
    });

    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42_424,
        harnessSessionId: HARNESS_SESSION_ID,
        nativeTurnPhase: 'idle' as const,
      }),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn().mockReturnValue(Runtime.defaultRuntime),
    } as unknown as DaemonAgentProcessManagerServiceShape;

    registerNativeDeliverySession({
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
          query: backendQuery,
        },
      } satisfies NativeTaskDeliverySessionDeps,
      machineId: MACHINE_ID,
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      notifyNativeTurnIdle({ chatroomId: 'room_1', role: 'builder' });

      await vi.waitFor(() => {
        expect(resumeTurnForSlot).toHaveBeenCalled();
      });

      expect(resumeTurnForSlot).toHaveBeenCalledWith({
        chatroomId: 'room_1',
        role: 'builder',
        prompt: buildNativeInjectionPrompt({
          taskDeliveryOutput: 'EVENT DRIVEN OUTPUT',
          augmentationMode: resolveSessionAugmentationForRole(
            '## Goal\nQueued follow-up after agent_end',
            'builder'
          ),
        }),
      });
      expect(backendMutation).toHaveBeenCalledWith(
        api.participants.join,
        expect.objectContaining({
          action: NATIVE_TASK_INJECTED_ACTION,
          taskId: 'task_promoted',
        })
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[NativeDelivery:primary] turn idle builder@room_1 — trying inject'
      );
    } finally {
      logSpy.mockRestore();
      unregisterNativeDeliverySession();
      clearAssignedTaskSnapshots();
    }
  });
});
