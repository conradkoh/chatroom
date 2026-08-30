/** A manually started native agent must accept pending work with a stale snapshot PID. */
import { Context, Effect, Runtime } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { MachineTaskSnapshotState } from './task-snapshot-state.js';
import { unregisterNativeDeliverySession } from '../../entry/native-delivery/native-delivery-session-registry.js';
import { reconcileDeliverableWorkForRole } from '../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  operationalRow,
  registerTestNativeDeliverySession,
} from '../agent-operational/test-support.js';

const runNativeInjectionEffect = vi.hoisted(() => vi.fn(() => Effect.void));
vi.mock('../../entry/native-delivery/native-task-injector.js', () => ({
  runNativeInjectionEffect,
}));

const CHATROOM_ID = 'manual-start-room';
const MACHINE_ID = 'manual-start-machine';
const ROLE = 'builder';
const STALE_SNAPSHOT_PID = 41_001;
const NEW_SLOT_PID = 99_002;

function pendingTask() {
  return {
    taskId: 'manual-start-task' as never,
    chatroomId: CHATROOM_ID as never,
    status: 'pending' as const,
    assignedTo: ROLE,
    updatedAt: 1,
    createdAt: 1,
    agentConfig: {
      role: ROLE,
      machineId: MACHINE_ID,
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp',
      model: 'composer-1',
      spawnedAgentPid: STALE_SNAPSHOT_PID,
      desiredState: 'running' as const,
    },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
  };
}

describe('pending task on manual agent start', () => {
  afterEach(() => {
    unregisterNativeDeliverySession();
    vi.clearAllMocks();
  });

  test('delivers pending task when the new healthy slot has a different PID', async () => {
    const row = pendingTask();
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: NEW_SLOT_PID,
        harnessSessionId: 'manual-start-harness',
        nativeTurnPhase: 'idle',
      }),
      resumeTurnForSlot: vi.fn().mockResolvedValue(undefined),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
    };
    const sessionDeps = {
      sessionId: 'manual-start-session',
      convexUrl: 'http://test',
      machineId: MACHINE_ID,
      logEvent: vi.fn(),
      backend: {
        mutation: vi.fn(),
        query: vi.fn().mockImplementation(async (_fn: unknown, args: Record<string, unknown>) => {
          if ('taskId' in args) return { ...row, taskContent: 'pending manual-start task' };
          return { tasks: [row] };
        }),
      },
    };
    const taskSnapshotState = new MachineTaskSnapshotState();
    taskSnapshotState.replace([row as never]);

    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: agentMgr as never,
      sessionDeps: sessionDeps as never,
      machineId: MACHINE_ID,
      taskSnapshotState,
      operationalRows: [operationalRow(CHATROOM_ID, ROLE, 'running')],
    });

    reconcileDeliverableWorkForRole(CHATROOM_ID, ROLE);

    await vi.waitFor(() => expect(runNativeInjectionEffect).toHaveBeenCalled());
    expect(agentMgr.getSlot).toHaveBeenCalledWith(CHATROOM_ID, ROLE);
    expect(runNativeInjectionEffect).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: row.taskId }),
      'manual-start-harness',
      expect.any(Object)
    );
  });
});
