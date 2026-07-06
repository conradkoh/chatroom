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
import { NativeDeliveryLedger } from './native-delivery-ledger.js';
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
    desiredState: 'running',
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
      getSlot: vi.fn().mockReturnValue({ harnessSessionId: HARNESS_SESSION_ID }),
      resumeTurnForSlot,
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    } as unknown as DaemonAgentProcessManagerServiceShape;

    const coordinator = new NativeTaskDeliveryCoordinator(new NativeDeliveryLedger());
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

    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(row!, {
        ledger,
        harnessSessionId: HARNESS_SESSION_ID,
      })
    ).toBe(true);
  });
});
