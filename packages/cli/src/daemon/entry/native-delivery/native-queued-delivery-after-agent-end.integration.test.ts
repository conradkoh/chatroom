/**
 * Daemon native delivery after agent_end + queue promotion — integration test
 *
 * Uses mocked harness (no real LLM calls). Included in default `pnpm test` suite.
 * Uses snapshot/participant shape produced by backend integration test.
 * Wires NativeTaskDeliveryCoordinator → runNativeInjectionEffect → resumeTurn.
 */

import type { Doc, Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { resolveSessionAugmentationForTask } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { snapshotDocToSignal } from '@workspace/backend/src/domain/usecase/machine/machine-assigned-task-snapshot-sync.js';
import { Context, Runtime } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import {
  NativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import { createTaskSnapshot } from './test-fixtures/task-snapshot-fixture.js';
import { withTestTaskService } from './test-task-service.js';
import { api } from '../../../api.js';
import type { AssignedTaskWithContent } from '../../../daemon/domain/entities/assigned-task.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import {
  buildNativeInjectionPrompt,
  shouldDeliverNativeTask,
} from '../../services/task-service/index.js';
import type { DaemonAgentProcessManagerServiceShape } from '../daemon-services.js';

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
  row: NonNullable<ReturnType<ReturnType<typeof createTaskSnapshot>['mergeSignal']>>
): AssignedTaskWithContent {
  return {
    ...row,
    taskContent: '## Goal\nQueued follow-up after agent_end',
  };
}

describe('native queued delivery after agent_end', () => {
  test('coordinator injects promoted pending task when participant is idle-after-complete', async () => {
    const snapshot = createTaskSnapshot();
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
        runSerializedForAgent: vi.fn() as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
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
        lifecycleOutbox: { enqueue: async () => undefined },
        operationalModel: new AgentOperationalReadModel(),
        isTaskActive: () => false,
      })
    );

    await vi.waitFor(() => {
      expect(resumeTurnForSlot).toHaveBeenCalled();
    });

    expect(resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: row!.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForTask(
          { content: '## Goal\nQueued follow-up after agent_end', startInNewSession: undefined },
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
    const snapshot = createTaskSnapshot();
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
});
